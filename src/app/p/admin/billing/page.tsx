import { AdminShell } from '@/app/p/admin/AdminShell';
import { rpc } from '@/data/rpc';
import { DEFAULT_LOCALE, translator } from '@/messages';
import { requireAdmin } from '@/platform/admin';
import { basePath } from '@/tenancy/context';

// Admin → Billing: schools by billing status, parent organizations and the last Stripe events
// received. Referral partners have their own page.
interface Overview {
  organisations: { id: string; name: string; schools: { id: string; slug: string; status: string }[] }[];
  by_status: Record<string, number>;
  events: { id: string; type: string; result: string; received_at: string }[];
}

export default async function AdminBilling() {
  const t = translator(DEFAULT_LOCALE);
  const a = await requireAdmin();
  const base = await basePath();
  const o = await rpc<Overview>('platform_billing_overview', {}, a);
  const when = new Intl.DateTimeFormat(DEFAULT_LOCALE, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  return (
    <AdminShell title={t('platform.billing.title')}>
      <div className="flex flex-col gap-5">
        <section aria-label={t('platform.billing.byStatus')} className="grid grid-cols-2 gap-3 md:grid-cols-6">
          {Object.entries(o.by_status).map(([s, n]) => (
            <div key={s} className="stat">
              <span className="label-text">{s}</span>
              <span className="stat-value">{n}</span>
            </div>
          ))}
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
    </AdminShell>
  );
}
