import 'server-only';
import { rpc } from '@/data/rpc';
import type { ScheduleItem } from './time';

// The current conference's schedule, read with the person's own rights.
export async function currentSchedule(tenantId: string, token: string): Promise<{ conferenceId: string | null; items: ScheduleItem[] }> {
  const conf = await rpc<{ id: string } | null>('current_conference', { p_tenant: tenantId }, { token }).catch(() => null);
  if (!conf) return { conferenceId: null, items: [] };
  return { conferenceId: conf.id, items: await rpc<ScheduleItem[]>('schedule_list', { p_conference: conf.id }, { token }).catch(() => []) };
}
