import { redirect } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { tenantTranslator } from '@/config/store';
import { rpc } from '@/data/rpc';
import { EXPORT_TABLES } from '@/data/export';
import { catalogs, type MessageKey } from '@/messages';
import { OwnerNav } from '@/site/OwnerNav';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { ImportForm } from './ImportForm';

// Owner → Export and import: everything the school has made, to keep, move or look at elsewhere,
// and bringing an export into a new, empty school.
export default async function DataPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!ctx.can('tenant.manage')) return <Notice title={t('forbidden.title')} body={t('forbidden.body')} locale={locale} />;

  const counts = (await rpc<Record<string, number> | null>('tenant_counts', { p_tenant: tenant.id }, { token: ctx.token })) ?? {};
  const empty = (counts.conferences ?? 0) === 0;
  const L = Object.fromEntries(
    Object.keys(catalogs.en)
      .filter((k) => k.startsWith('data.import.'))
      .map((k) => [k.slice('data.import.'.length), t(k as MessageKey)]),
  );
  for (const k of EXPORT_TABLES) L[`table_${k}`] = t(`data.table.${k}` as MessageKey);

  return (
    <Shell title={t('data.title')} size="full" locale={locale}>
      <OwnerNav base={base} t={t} can={(x) => ctx.can(x)} current={'data'}>
      <div className="flex flex-col gap-6">
        <section className="card flex flex-col gap-3" aria-labelledby="export-title">
          <h2 id="export-title" className="text-lg font-bold text-on-surface">
            {t('data.export')}
          </h2>
          <p className="text-sm">{t('data.export.help')}</p>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4" aria-label={t('data.counts')}>
            {EXPORT_TABLES.map((k) => (
              <li key={k} className="flex justify-between gap-2 border-b border-border py-1">
                <span>{t(`data.table.${k}` as MessageKey)}</span>
                <span className="font-mono">{counts[k] ?? 0}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <a className="btn btn-primary" href={`${base}/owner/export?format=json`}>
              {t('data.export.json')}
            </a>
            <a className="btn btn-secondary" href={`${base}/owner/export?format=csv`}>
              {t('data.export.csv')}
            </a>
            <a className="btn btn-secondary" href={`${base}/owner/export?format=pdf`}>
              {t('data.export.pdf')}
            </a>
          </div>
          <p className="text-xs">{t('data.export.people')}</p>
        </section>

        <section className="card flex flex-col gap-3" aria-labelledby="import-title">
          <h2 id="import-title" className="text-lg font-bold text-on-surface">
            {t('data.import')}
          </h2>
          {empty ? (
            <>
              <p className="text-sm">{t('data.import.help')}</p>
              <ImportForm endpoint={`${base}/owner/import`} L={L} />
            </>
          ) : (
            <p className="text-sm">{t('data.import.notEmpty')}</p>
          )}
        </section>
      </div>
      </OwnerNav>
    </Shell>
  );
}
