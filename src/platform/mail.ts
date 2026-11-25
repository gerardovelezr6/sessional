import 'server-only';

// Sends email through Resend's API. Server only; the key never reaches a browser. RESEND_API_URL
// exists for tests, which point it at a stand-in that keeps what was sent.

export function mailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY?.trim();
}

export async function sendMail(message: { to: string; subject: string; text: string; replyTo?: string }): Promise<boolean> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return false;
  const base = process.env.RESEND_API_URL?.trim().replace(/\/$/, '') || 'https://api.resend.com';
  try {
    const res = await fetch(`${base}/emails`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: process.env.CONTACT_FROM_EMAIL?.trim() || 'Sessional <onboarding@resend.dev>',
        to: [message.to],
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        subject: message.subject,
        text: message.text,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error(JSON.stringify({ event: 'mail_failed', status: res.status }));
    return res.ok;
  } catch (e) {
    console.error(JSON.stringify({ event: 'mail_failed', reason: e instanceof Error ? e.name : 'unknown' }));
    return false;
  }
}
