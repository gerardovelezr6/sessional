// A school's health at a glance, from its usage counts: is it set up, is it used, is it alive.
// 0–100, with the reasons that cost points, so support knows where to look first.

export interface Usage {
  members: number;
  invited: number;
  conferences: number;
  committees: number;
  delegates: number;
  sessions_30d: number;
  changes_30d: number;
  last_activity: string | null;
  settings_published: number;
  domains: number;
}

export type HealthReason = 'no_activity' | 'quiet' | 'no_conference' | 'no_committees' | 'no_delegates' | 'alone' | 'invites_waiting' | 'not_customised' | 'no_sessions';

export interface Health {
  score: number;
  level: 'good' | 'watch' | 'risk';
  reasons: HealthReason[];
}

const DAY = 86_400_000;

export function healthOf(u: Usage, status: string, now = Date.now()): Health {
  const reasons: HealthReason[] = [];
  let score = 100;
  const cost = (points: number, reason: HealthReason) => {
    score -= points;
    reasons.push(reason);
  };
  const idle = u.last_activity ? (now - Date.parse(u.last_activity)) / DAY : Infinity;
  if (idle > 60) cost(30, 'no_activity');
  else if (idle > 14) cost(15, 'quiet');
  if (u.conferences === 0) cost(20, 'no_conference');
  else if (u.committees === 0) cost(15, 'no_committees');
  else if (u.delegates === 0) cost(10, 'no_delegates');
  if (u.members <= 1) cost(10, 'alone');
  if (u.invited > 0 && u.invited >= u.members) cost(5, 'invites_waiting');
  if (u.settings_published === 0) cost(10, 'not_customised');
  if (u.committees > 0 && u.sessions_30d === 0 && idle <= 14) cost(5, 'no_sessions');
  score = Math.max(0, score);
  // A school that cannot be used is at risk whatever its numbers.
  const blocked = status === 'suspended' || status === 'deleted' || status === 'read_only' || status === 'past_due';
  const level = blocked || score < 50 ? 'risk' : score < 75 ? 'watch' : 'good';
  return { score, level, reasons };
}

// Whether a stored time has passed (kept out of components, which must not read the clock).
export const isPast = (iso: string) => Date.parse(iso) <= Date.now();

// The badge colour of each level.
export const LEVEL_TONE = { good: 'tone-live', watch: 'tone-paused', risk: 'tone-idle' } as const;
