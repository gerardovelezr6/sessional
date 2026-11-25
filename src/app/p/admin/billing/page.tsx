import { ActionForm } from '@/components/ActionForm';
import { Shell } from '@/components/Shell';
import { rpc } from '@/data/rpc';
import { DEFAULT_LOCALE, translator } from '@/messages';
import { requireAdmin } from '@/platform/admin';
import { basePath } from '@/tenancy/context';
import { referralAction } from '../actions';

// Admin → Billing: schools by billing status, parent organisations, referral partners with the
// schools that came with them, and the last Stripe events received.
interface Overview {
  organisations: { id: string; name: string; schools: { id: string; slug: string; status: string }[] }[];
  by_status: Record<string, number>;
  events: { id: string; type: string; result: string; received_at: string }[];
}
interface Referral {
  code: string;
  name: string;
  percent_off: number;
  active: boolean;
  stripe_promotion_code_id: string | null;
  schools: number;
  paying: number;
}

export default async function AdminBilling({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const t = translator(DEFAULT_LOCALE);
  const a = await requireAdmin();
  const base = await basePath();
  const o = await rpc<Overview>('platform_billing_overview', {}, a);
  const referrals = await rpc<Referral[]>('platform_referrals', {}, a);
  const { done } = await searchParams;
  const when = new Intl.DateTimeFormat(DEFAULT_LOCALE, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  return (
    <Shell title={t('platform.billing.title')} size="full">
      <div className="flex flex-col gap-5">
        {done ? (
          <p role="status" className="card font-semibold text-on-surface">
            {t('platform.billing.referralSaved')}
          </p>
        ) : null}
        <section aria-label={t('platform.billing.byStatus')} className="grid grid-cols-2 gap-3 md:grid-cols-6">
          {Object.entries(o.by_status).map(([s, n]) => (
            <div key={s} className="stat">
              <span className="label-text">{s}</span>
              <span className="stat-value">{n}</span>
            </div>
          ))}
        </section>

        <section className="card flex flex-col gap-3" aria-labelledby="referrals">
          <h2 id="referrals" className="text-lg font-bold text-on-surface">
            {t('platform.billing.referrals')}
          </h2>
          <p className="text-sm">{t('platform.billing.referralsHelp')}</p>
          <table className="table text-sm" aria-label={t('platform.billing.referrals')}>
            <thead>
              <tr>
                <th>{t('platform.billing.code')}</th>
                <th>{t('platform.billing.partner')}</th>
                <th>{t('platform.billing.discount')}</th>
                <th>{t('platform.billing.schools')}</th>
                <th>{t('platform.billing.paying')}</th>
              </tr>
            </thead>
            <tbody>
              {referrals.map((r) => (
                <tr key={r.code}>
                  <td className="font-mono">{r.code}</td>
                  <td>{r.name}</td>
                  <td>{r.percent_off ? `${r.percent_off}%` : '—'}</td>
                  <td className="font-mono">{r.schools}</td>
                  <td className="font-mono">{r.paying}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ActionForm action={referralAction} submitLabel={t('platform.billing.addReferral')} variant="secondary">
            <div className="flex flex-wrap gap-3">
              <label className="flex flex-col gap-1">
                <span className="label">{t('platform.billing.code')}</span>
                <input className="input w-40 font-mono uppercase" name="code" required pattern="[A-Za-z0-9][A-Za-z0-9-]{2,29}" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="label">{t('platform.billing.partner')}</span>
                <input className="input w-60" name="name" required maxLength={120} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="label">{t('platform.billing.discountPercent')}</span>
                <input className="input w-24" name="percent_off" type="number" min={0} max={100} defaultValue={10} />
              </label>
            </div>
          </ActionForm>
        </section>

        <section className="card flex flex-col gap-2" aria-labelledby="orgs">
          <h2 id="orgs" className="text-lg font-bold text-on-surface">
            {t('platform.billing.organisations')}
          </h2>
          {o.organisations.length === 0 ? <p className="text-sm">{t('platform.billing.noOrganisations')}</p> : null}
          <ul className="flex flex-col text-sm">
            {o.organisations.map((g) => (
              <li key={g.id} className="border-b border-border py-1">
                <span className="font-semibold text-on-surface">{g.name}</span>
                {' · '}
                {g.schools.map((s, i) => (
                  <span key={s.id}>
                    {i ? ', ' : ''}
                    <a className="underline underline-offset-2" href={`${base}/tenants/${s.id}`}>
                      {s.slug}
                    </a>
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </section>

        <section className="card flex flex-col gap-2" aria-labelledby="events">
          <h2 id="events" className="text-lg font-bold text-on-surface">
            {t('platform.billing.events')}
          </h2>
          <ul className="flex flex-col font-mono text-xs">
            {o.events.map((e) => (
              <li key={e.id} className="border-b border-border py-1">{`${when.format(new Date(e.received_at))} · ${e.type} · ${e.result}`}</li>
            ))}
          </ul>
        </section>
      </div>
    </Shell>
  );
}
