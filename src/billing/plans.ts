// Plans as the database holds them, and the rules about moving between them. Pure: used by the
// billing page, the server actions and the tests.

export const LIMITS = ['committees', 'delegates', 'staff', 'active_conferences'] as const;
export type LimitKey = (typeof LIMITS)[number];
export type Limits = Partial<Record<LimitKey | 'storage_mb', number | null>>;
export type Usage = Record<LimitKey, number>;

export interface Price {
  key: string;
  interval: 'month' | 'year' | 'conference';
  currency: 'mxn' | 'usd';
  amount: number;
  stripe_price_id?: string | null;
}
export interface Plan {
  key: string;
  name: Record<string, string>;
  description: Record<string, string>;
  limits: Limits;
  features: Record<string, boolean>;
  prices: Price[];
  per_school: boolean;
  sort?: number;
}

// How full one limit is: under 80%, from 80% (a warning), at the limit (nothing more can be added).
export function meter(used: number, limit: number | null | undefined): { level: 'ok' | 'near' | 'full' | 'unlimited'; percent: number } {
  if (limit === null || limit === undefined) return { level: 'unlimited', percent: 0 };
  const percent = limit <= 0 ? 100 : Math.min(100, Math.round((used / limit) * 100));
  return { level: used >= limit ? 'full' : percent >= 80 ? 'near' : 'ok', percent };
}

// What keeps a school from moving to a plan: each limit its current use is above.
export function blockersFor(usage: Usage, limits: Limits): { what: LimitKey; used: number; max: number }[] {
  return LIMITS.flatMap((what) => {
    const max = limits[what];
    return typeof max === 'number' && usage[what] > max ? [{ what, used: usage[what], max }] : [];
  });
}

// Moving up applies now (and is charged for the rest of the period); moving down waits for the
// end of the period. Up means a later plan in the list.
export function direction(plans: Plan[], from: string | null, to: string): 'up' | 'down' | 'same' {
  if (!from || from === to) return from === to ? 'same' : 'up';
  const i = plans.findIndex((p) => p.key === from);
  const j = plans.findIndex((p) => p.key === to);
  return j > i ? 'up' : 'down';
}

// An amount in the currency's usual form: 34900 MXN → "$349.00 MXN".
export function money(amount: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: currency.toUpperCase(), currencyDisplay: 'symbol' }).format(amount / 100) + ` ${currency.toUpperCase()}`;
}
