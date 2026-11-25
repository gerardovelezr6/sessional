import 'server-only';
import { rpc } from '@/data/rpc';
import { lookup, matches } from './dns';
import { mailConfigured, syncSendingDomain } from './mail';

// Checks a school's sending domain with the email provider and a live DNS lookup, and records it.
export async function checkSender(tenantId: string, domain: string, providerId: string | null) {
  let data: Record<string, unknown>;
  try {
    if (!mailConfigured()) {
      data = { status: 'pending', problem: 'provider' };
    } else {
      const s = await syncSendingDomain(domain, providerId);
      const records = await Promise.all(
        s.records.map(async (r) => {
          const found = await lookup(r.name, (['TXT', 'MX', 'CNAME', 'A'].includes(r.type) ? r.type : 'TXT') as 'TXT');
          // An MX answer reads "10 feedback-smtp…": compare the host part.
          return { ...r, found, ok: matches(r.type === 'MX' ? found.map((f) => f.replace(/^\d+\s+/, '')) : found, r.value) };
        }),
      );
      data = { provider_id: s.providerId, records, status: s.verified ? 'verified' : s.failed ? 'error' : 'pending', problem: s.verified ? '' : 'dns' };
    }
  } catch (e) {
    data = { status: 'error', problem: e instanceof Error ? e.message.slice(0, 200) : 'unknown' };
  }
  await rpc('mail_sender_server_set', { p_tenant: tenantId, p_data: data }, 'service');
  return data.status as 'verified' | 'pending' | 'error';
}
