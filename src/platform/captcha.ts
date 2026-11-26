import 'server-only';

// The "are you a person" check on public forms (signup, contact, support): Cloudflare Turnstile.
// Most people see nothing to solve; it sets no tracking cookies. Off when its keys aren't set (the
// honeypot and timing checks and the rate limits still apply). TURNSTILE_SCRIPT_URL and
// TURNSTILE_VERIFY_URL exist for tests, which point them at a stand-in.

export function captchaClient(): { siteKey: string; script: string } | null {
  const siteKey = process.env.TURNSTILE_SITE_KEY?.trim();
  if (!siteKey || !process.env.TURNSTILE_SECRET_KEY?.trim()) return null;
  return { siteKey, script: process.env.TURNSTILE_SCRIPT_URL?.trim() || 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit' };
}

export async function captchaPassed(data: FormData, address: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret || !process.env.TURNSTILE_SITE_KEY?.trim()) return true;
  const token = String(data.get('cf-turnstile-response') ?? '');
  if (!token || token.length > 2048) return false;
  const body = new URLSearchParams({ secret, response: token, ...(address && address !== 'unknown' ? { remoteip: address } : {}) });
  try {
    const res = await fetch(process.env.TURNSTILE_VERIFY_URL?.trim() || 'https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(8000), cache: 'no-store' });
    const out = (await res.json()) as { success?: boolean };
    return out.success === true;
  } catch {
    // Cloudflare unreachable: let people through rather than lock everyone out; the other checks stay.
    console.error(JSON.stringify({ event: 'captcha_unreachable' }));
    return true;
  }
}
