import 'server-only';
import { rpc } from '@/data/rpc';
import { lookup, matches } from './dns';
import { hostingConfigured, pointingRecord, syncDomain, type HostingRecord } from './hosting';

// Checks one of a school's domains and records the outcome. A domain serves only when the hosting
// provider has verified it and DNS points at us; the page shows each record to create next to what
// a live lookup finds right now, so the guidance and the check always agree.

export interface CheckedRecord extends HostingRecord {
  found: string[];
  ok: boolean;
}

export type DomainOutcome = { status: 'verified' | 'pending' | 'error'; records: CheckedRecord[]; problem: string | null };

async function checkRecords(records: HostingRecord[]): Promise<CheckedRecord[]> {
  return Promise.all(
    records.map(async (r) => {
      const found = await lookup(r.name, r.type);
      // An apex domain behind a provider that flattens CNAMEs still resolves to our address.
      return { ...r, found, ok: matches(found, r.value) };
    }),
  );
}

export async function checkDomain(tenantId: string, host: string): Promise<DomainOutcome> {
  const wanted: HostingRecord[] = [pointingRecord(host)];
  let outcome: DomainOutcome;
  try {
    if (!hostingConfigured()) {
      const records = await checkRecords(wanted);
      outcome = { status: 'pending', records, problem: 'hosting' };
    } else {
      const state = await syncDomain(host);
      const records = await checkRecords([...wanted, ...state.verification]);
      const dnsOk = records.every((r) => r.ok);
      outcome = state.verified && !state.misconfigured ? { status: 'verified', records, problem: null } : { status: 'pending', records, problem: dnsOk ? 'propagating' : 'dns' };
    }
  } catch (e) {
    outcome = { status: 'error', records: await checkRecords(wanted), problem: e instanceof Error ? e.message.slice(0, 200) : 'unknown' };
  }
  await rpc('domain_server_set', { p_tenant: tenantId, p_host: host, p_data: outcome }, 'service');
  console.info(JSON.stringify({ event: 'domain_checked', tenant: tenantId, status: outcome.status }));
  return outcome;
}
