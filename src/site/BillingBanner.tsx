import { rpc } from '@/data/rpc';
import type { Translate } from '@/messages';

// The school's billing, where it matters: everyone sees that a read-only school cannot be changed;
// the people who manage the school also see a failed payment (and until when it still works) and
// a trial ending within three days, with the way to the billing page.
export async function BillingBanner({ tenantId, status, token, manager, base, locale, t, now }: { tenantId: string; status: string; token: string | null; manager: boolean; base: string; locale: string; t: Translate; now: number }) {
  const s = manager && token ? await rpc<{ metered: boolean; trial_ends_at: string | null; grace_until: string | null } | null>('billing_state', { p_tenant: tenantId }, { token }).catch(() => null) : null;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'long' });
  const link = manager ? (
    <a className="ms-2 underline underline-offset-2" href={`${base}/owner/billing`}>
      {t('billing.banner.open')}
    </a>
  ) : null;
  let text: string | null = null;
  let strong = false;
  if (status === 'read_only') {
    text = t(manager ? 'billing.banner.readOnlyManager' : 'billing.banner.readOnly');
    strong = true;
  } else if (manager && s?.metered && status === 'past_due') {
    text = t('billing.banner.pastDue', { date: s.grace_until ? date.format(new Date(s.grace_until)) : '—' });
    strong = true;
  } else if (manager && s?.metered && status === 'trialing' && s.trial_ends_at && Date.parse(s.trial_ends_at) - now < 3 * 86_400_000) {
    text = t('billing.banner.trialEnding', { date: date.format(new Date(s.trial_ends_at)) });
  }
  if (!text) return null;
  return (
    <aside aria-label={t('billing.banner.label')} className={`px-4 py-2 text-center text-sm font-semibold ${strong ? 'bg-danger text-on-danger' : 'bg-warning-soft text-on-warning-soft'}`}>
      {text}
      {link}
    </aside>
  );
}
