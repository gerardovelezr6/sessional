import { AdminShell } from '@/app/p/admin/AdminShell';
import { rpc } from '@/data/rpc';
import { DEFAULT_LOCALE, translator, type MessageKey } from '@/messages';
import { requireAdmin } from '@/platform/admin';
import { healthOf, LEVEL_TONE, type Usage } from '@/platform/health';
import { basePath } from '@/tenancy/context';

// Admin → Schools: every school with its status, usage and health score, searchable.

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  plan_key: string | null;
  created_at: string;
  deleted_at: string | null;
  purge_after: string | null;
  usage: Usage;
}

export default async function AdminSchools({ searchParams }: { searchParams: Promise<{ q?: string; done?: string }> }) {
  const t = translator(DEFAULT_LOCALE);
  const a = await requireAdmin();
  const base = await basePath();
  const { q = '', done } = await searchParams;
  const list = await rpc<TenantRow[]>('platform_tenants', { p_query: q.slice(0, 80) }, a);
  const date = new Intl.DateTimeFormat(DEFAULT_LOCALE, { dateStyle: 'medium' });
  const byStatus = list.reduce<Record<string, number>>((m, x) => ({ ...m, [x.status]: (m[x.status] ?? 0) + 1 }), {});

  return (
    <AdminShell title={t('platform.schools.title')}>
      <div className="flex flex-col gap-5">
        {done === 'purged' ? (
          <p role="status" className="card font-semibold text-on-surface">
            {t('platform.done.purged')}
          </p>
        ) : null}
        <section aria-label={t('platform.schools.summary')} className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {['active', 'trialing', 'past_due', 'suspended', 'deleted'].map((s) => (
            <div key={s} className="stat">
              <span className="label-text">{t(`platform.status.${s}` as MessageKey)}</span>
              <span className="stat-value">{byStatus[s] ?? 0}</span>
            </div>
          ))}
        </section>
        <form method="get" className="flex flex-wrap items-end gap-2" role="search">
          <label className="flex flex-col gap-1">
            <span className="label">{t('platform.schools.search')}</span>
            <input className="input w-72" name="q" defaultValue={q} maxLength={80} />
          </label>
          <button type="submit" className="btn btn-secondary">
            {t('platform.schools.find')}
          </button>
        </form>
        <div className="overflow-x-auto">
          <table className="table text-sm" aria-label={t('platform.schools.title')}>
            <thead>
              <tr>
                <th>{t('platform.col.school')}</th>
                <th>{t('platform.col.status')}</th>
                <th>{t('platform.col.health')}</th>
                <th>{t('platform.col.members')}</th>
                <th>{t('platform.col.conferences')}</th>
                <th>{t('platform.col.delegates')}</th>
                <th>{t('platform.col.lastActivity')}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((x) => {
                const h = healthOf(x.usage, x.status);
                return (
                  <tr key={x.id}>
                    <td>
                      <a className="font-semibold underline underline-offset-2" href={`${base}/tenants/${x.id}`}>
                        {x.name}
                      </a>
                      <span className="block font-mono text-xs">{x.slug}</span>
                    </td>
                    <td>
                      <span className="badge">{t(`platform.status.${x.status}` as MessageKey)}</span>
                    </td>
                    <td>
                      <span className={`badge ${LEVEL_TONE[h.level]}`}>{`${h.score} · ${t(`platform.health.${h.level}` as MessageKey)}`}</span>
                    </td>
                    <td className="font-mono">{x.usage.members}</td>
                    <td className="font-mono">{x.usage.conferences}</td>
                    <td className="font-mono">{x.usage.delegates}</td>
                    <td>{x.usage.last_activity ? date.format(new Date(x.usage.last_activity)) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {list.length === 0 ? <p className="text-sm">{t('platform.schools.none')}</p> : null}
      </div>
    </AdminShell>
  );
}
