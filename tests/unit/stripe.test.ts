import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

describe('Stripe', () => {
  it('webhooks: only a valid signature, made recently, is accepted', async () => {
    const { signWebhook, verifyWebhook } = await import('@/billing/stripe');
    const payload = '{"id":"evt_1","type":"invoice.paid"}';
    const now = 1_800_000_000;
    const header = signWebhook(payload, 'whsec_test', now);
    expect(verifyWebhook(payload, header, 'whsec_test', now)).toBe(true);
    // Rotated secrets: any v1 may match.
    expect(verifyWebhook(payload, `${header},v1=${'0'.repeat(64)}`, 'whsec_test', now)).toBe(true);
    expect(verifyWebhook(payload.replace('paid', 'failed'), header, 'whsec_test', now)).toBe(false);
    expect(verifyWebhook(payload, header, 'whsec_other', now)).toBe(false);
    expect(verifyWebhook(payload, header, 'whsec_test', now + 301)).toBe(false);
    expect(verifyWebhook(payload, null, 'whsec_test', now)).toBe(false);
    expect(verifyWebhook(payload, 't=abc,v1=xyz', 'whsec_test', now)).toBe(false);
    expect(verifyWebhook(payload, header, '', now)).toBe(false);
  });

  it('form encoding: nested objects and arrays as Stripe reads them', async () => {
    const { formEncode } = await import('@/billing/stripe');
    expect(formEncode({ mode: 'subscription', line_items: [{ price: 'price_1', quantity: 2 }], metadata: { tenant_id: 'x y' }, skip: undefined, expand: ['a', 'b'] })).toEqual([
      'mode=subscription',
      'line_items%5B0%5D%5Bprice%5D=price_1',
      'line_items%5B0%5D%5Bquantity%5D=2',
      'metadata%5Btenant_id%5D=x%20y',
      'expand%5B0%5D=a',
      'expand%5B1%5D=b',
    ]);
  });
});

describe('per-school volume pricing', () => {
  it('every school costs the price of the step the organization has reached', async () => {
    const { perSchoolAmount } = await import('@/billing/stripe');
    const volume = [{ from: 5, percent_off: 10 }, { from: 10, percent_off: 20 }];
    expect(perSchoolAmount(119000, volume, 1)).toBe(119000);
    expect(perSchoolAmount(119000, volume, 4)).toBe(119000);
    expect(perSchoolAmount(119000, volume, 5)).toBe(107100);
    expect(perSchoolAmount(119000, volume, 12)).toBe(95200);
    expect(perSchoolAmount(119000, [], 12)).toBe(119000);
  });
});
