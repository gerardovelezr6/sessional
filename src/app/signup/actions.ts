'use server';
import { headers } from 'next/headers';
import { generateLink, updatePassword, verifyTokenHash } from '@/auth/gotrue';
import { rpc } from '@/data/rpc';
import { translator, type MessageKey } from '@/messages';
import { passwordProblems } from '@/people/password';
import { looksAutomated, senderKey } from '@/platform/contact';
import { isSecureOrigin, rootDomain } from '@/platform/env';
import { sendMail } from '@/platform/mail';
import { captchaPassed } from '@/platform/captcha';
import { hashOf, isSecret, parseSignup, secret, TERMS_VERSION, type SignupField } from '@/platform/signup';

export interface SignupState {
  status: 'idle' | 'sent' | 'invalid' | 'rate' | 'failed' | 'captcha';
  fields?: SignupField[];
  slugProblem?: 'format' | 'reserved' | 'taken';
  // What was typed, to put back in the form (React clears a form after its action runs).
  values?: Record<string, string>;
}

const KEEP = ['name', 'email', 'school', 'slug', 'locale', 'adult', 'terms', 'ref'];
const typed = (data: FormData) => Object.fromEntries(KEEP.map((k) => [k, String(data.get(k) ?? '')]));

const scheme = () => (isSecureOrigin() ? 'https' : 'http');

// Step one: a school is asked for. Nothing is created; a link is emailed. The answer is the same
// whether or not the address already has an account, so the form can't be used to find accounts.
export async function signupAction(_prev: SignupState, data: FormData): Promise<SignupState> {
  if (looksAutomated(data, Date.now())) return { status: 'sent' };
  const parsed = parseSignup(data);
  if (!parsed.ok) return { status: 'invalid', fields: parsed.fields, values: typed(data) };
  const v = parsed.value;
  const h = await headers();
  const address = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
  if (!(await captchaPassed(data, address))) return { status: 'captcha', values: typed(data) };
  const link = secret();
  try {
    const r = await rpc<{ id?: string; error?: string }>(
      'signup_start',
      { p_data: { email: v.email, name: v.name, school: v.school, slug: v.slug, locale: v.locale, terms_version: TERMS_VERSION }, p_sender: senderKey(address), p_secret_hash: hashOf(link) },
      'service',
    );
    if (r.error === 'rate') return { status: 'rate', values: typed(data) };
    if (r.error?.startsWith('slug_')) return { status: 'invalid', fields: ['slug'], slugProblem: r.error.slice(5) as SignupState['slugProblem'], values: typed(data) };
    if (!r.id) return { status: 'failed', values: typed(data) };
    // A partner's code: kept with the signup if it's a real one (unknown codes are dropped quietly).
    const ref = String(data.get('ref') ?? '').trim().toUpperCase();
    if (/^[A-Z0-9][A-Z0-9-]{2,29}$/.test(ref)) await rpc('signup_referral_set', { p_id: r.id, p_code: ref }, 'service').catch(() => null);
    const t = translator(v.locale);
    const url = `${scheme()}://${rootDomain()}/signup/confirm?i=${r.id}&h=${link}`;
    const sent = await sendMail({
      to: v.email,
      subject: t('signup.mail.subject', { school: v.school }),
      text: t('signup.mail.body', { name: v.name, school: v.school, address: `${v.slug}.${rootDomain()}`, url }),
    });
    console.info(JSON.stringify({ event: 'signup_started', sent }));
    return sent ? { status: 'sent' } : { status: 'failed', values: typed(data) };
  } catch {
    return { status: 'failed', values: typed(data) };
  }
}

export interface ConfirmState {
  error?: string;
  slugProblem?: 'format' | 'reserved' | 'taken';
  redirectTo?: string;
}

// Step two, from the emailed link, when the person presses the button: the account is created (or
// the existing one used), then the school, then the person is sent to it, signed in.
export async function confirmSignupAction(id: string, link: string, _prev: ConfirmState, data: FormData): Promise<ConfirmState> {
  if (!isSecret(link) || !/^[0-9a-f-]{36}$/.test(id)) return { error: 'invalid' };
  const peek = await rpc<{ email: string; name: string; school: string; slug: string; locale: 'en' | 'es'; has_account: boolean } | null>('signup_peek', { p_id: id, p_secret_hash: hashOf(link) }, 'service').catch(() => null);
  if (!peek) return { error: 'invalid' };
  const t = translator(peek.locale);
  let userId: string | null = null;

  if (!peek.has_account) {
    const password = String(data.get('password') ?? '');
    const problems = passwordProblems(password, { passwordMinLength: 8, passwordRequire: 'length', passwordBlockCommon: 'on' }, { email: peek.email, school: peek.school });
    if (problems.length) return { error: problems.map((p) => t(`setPassword.error.${p}` as MessageKey, { min: 8 })).join(' ') };
    if (password !== String(data.get('repeat') ?? '')) return { error: t('setPassword.error.mismatch') };
    // A new address gets an account; one that was invited somewhere but never chose a password
    // gets that password now.
    let made = await generateLink('invite', peek.email, { full_name: peek.name });
    let type: 'invite' | 'recovery' = 'invite';
    if (!made.ok && made.reason === 'exists') {
      made = await generateLink('recovery', peek.email);
      type = 'recovery';
    }
    if (!made.ok) return { error: t('auth.error.unavailable') };
    const session = await verifyTokenHash(made.value.tokenHash, type);
    if (!session.ok) return { error: t('auth.error.unavailable') };
    const changed = await updatePassword(session.value.accessToken, password);
    if (!changed.ok) return { error: t(changed.reason === 'unavailable' ? 'auth.error.unavailable' : 'setPassword.error.rejected') };
    await rpc('complete_onboarding', { p_user: session.value.userId }, 'service');
    userId = session.value.userId;
  }
  // The address is proven by the link: an existing account (with or without a password) is used.
  if (!userId) userId = (await rpc<{ id: string } | null>('find_account', { p_email: peek.email }, 'service').catch(() => null))?.id ?? null;
  if (!userId) return { error: t('auth.error.unavailable') };

  const pass = secret();
  const slug = String(data.get('slug') ?? '').trim().toLowerCase();
  const done = await rpc<{ tenant_id?: string; slug?: string; error?: string }>(
    'signup_finish',
    { p_id: id, p_secret_hash: hashOf(link), p_user: userId, p_slug: slug, p_handoff_hash: hashOf(pass) },
    'service',
  ).catch((): { tenant_id?: string; slug?: string; error?: string } => ({ error: 'failed' }));
  if (done.error?.startsWith('slug_')) return { slugProblem: done.error.slice(5) as ConfirmState['slugProblem'] };
  if (done.error || !done.slug) return { error: done.error === 'invalid' ? 'invalid' : t('auth.error.unavailable') };
  console.info(JSON.stringify({ event: 'signup_finished', tenant: done.tenant_id }));
  return { redirectTo: `${scheme()}://${done.slug}.${rootDomain()}/auth/welcome?i=${id}&h=${pass}` };
}
