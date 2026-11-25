import { describe, expect, it } from 'vitest';
import { blockersFor, direction, meter, money, type Plan } from '@/billing/plans';

const plan = (key: string): Plan => ({ key, name: { en: key }, description: {}, limits: {}, features: {}, prices: [], per_school: false });

describe('billing rules', () => {
  it('meters warn from 80% and stop at the limit; no limit is unlimited', () => {
    expect(meter(5, 10)).toEqual({ level: 'ok', percent: 50 });
    expect(meter(8, 10)).toEqual({ level: 'near', percent: 80 });
    expect(meter(10, 10)).toEqual({ level: 'full', percent: 100 });
    expect(meter(12, 10)).toEqual({ level: 'full', percent: 100 });
    expect(meter(400, null)).toEqual({ level: 'unlimited', percent: 0 });
  });
  it('a downgrade is blocked by every limit the school is above, with the numbers', () => {
    const usage = { committees: 9, delegates: 140, staff: 12, active_conferences: 1 };
    expect(blockersFor(usage, { committees: 6, delegates: 150, staff: 10, active_conferences: 1 })).toEqual([
      { what: 'committees', used: 9, max: 6 },
      { what: 'staff', used: 12, max: 10 },
    ]);
    expect(blockersFor(usage, { committees: 60, delegates: null, staff: null })).toEqual([]);
  });
  it('up or down follows the order of the plans', () => {
    const plans = ['starter', 'conference', 'institution'].map(plan);
    expect(direction(plans, 'starter', 'institution')).toBe('up');
    expect(direction(plans, 'institution', 'conference')).toBe('down');
    expect(direction(plans, 'conference', 'conference')).toBe('same');
    expect(direction(plans, null, 'starter')).toBe('up');
  });
  it('money in both currencies', () => {
    expect(money(34900, 'mxn', 'es-MX')).toBe('$349.00 MXN');
    expect(money(1900, 'usd', 'en-US')).toBe('$19.00 USD');
  });
});
