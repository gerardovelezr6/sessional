import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { RETURN_COOKIE } from '@/auth/oauth';
import { rpc } from '@/data/rpc';
import { DEFAULT_LOCALE, translator } from '@/messages';
import { rootDomain, isSecureOrigin } from '@/platform/env';
import { legalDetails } from '@/platform/legal';
import { Landing, type PlanRow } from '@/site/landing/Landing';
import { parseTenantKey } from '@/tenancy/route';

// The main page. If the authentication service ever lands a sign-in here (its fallback address),
// the code is handed on to the school the sign-in started from. Otherwise: what Sessional is.
export default async function HomePage({ searchParams }: { searchParams: Promise<{ code?: string; error?: string; error_code?: string; lang?: string }> }) {
  const q = await searchParams;
  const school = (await cookies()).get(RETURN_COOKIE)?.value;
  if ((q.code || q.error) && school && parseTenantKey(school)) {
    const pass = new URLSearchParams(q.code ? { code: q.code.slice(0, 500) } : { error: String(q.error).slice(0, 100), ...(q.error_code ? { error_code: String(q.error_code).slice(0, 100) } : {}) });
    redirect(`/auth/return/${encodeURIComponent(school)}?${pass}`);
  }
  const locale = q.lang === 'es' ? 'es' : DEFAULT_LOCALE === 'es' ? 'es' : 'en';
  const t = translator(locale);
  // A sign-in that landed here without a school to hand it to: a link used twice (Back, Reload,
  // an old tab) or one started before this browser was seen. Say so instead of showing nothing.
  const unfinished = !!(q.code || q.error);
  const origin = `${isSecureOrigin() ? 'https' : 'http'}://${rootDomain()}`;
  const appUrl = `${isSecureOrigin() ? 'https' : 'http'}://app.${rootDomain()}/login`;
  const legal = legalDetails();
  const contact = process.env.LEGAL_CONTACT_EMAIL?.trim() ? legal.email : null;
  const qr = await QRCode.toString(origin, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
  // Prices come from the plans table; until billing is set up the section says so instead.
  let plans: PlanRow[] | null = null;
  try {
    plans = await rpc<PlanRow[]>('plans_public', {}, 'service');
  } catch {
    plans = null;
  }
  return (
    <div lang={locale} className="flex flex-1 flex-col">
      {unfinished ? (
        <section role="alert" className="card mx-auto mt-6 max-w-xl text-start">
          <h1 className="text-lg font-bold text-on-surface">{t('home.signInUnfinished.title')}</h1>
          <p className="mt-2 text-sm">{t('home.signInUnfinished.body', { domain: rootDomain() })}</p>
        </section>
      ) : null}
      <Landing t={t} locale={locale} appUrl={appUrl} contact={contact} qr={qr} plans={plans} />
    </div>
  );
}
