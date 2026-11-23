import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { tenantTranslator } from '@/config/store';
import { rpc } from '@/data/rpc';
import { OwnerTabs } from '@/site/AdminTabs';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { resetSchoolAction } from './actions';

// Owner → Reset: start over with no conferences. Settings, roles and people stay. Only the Owner,
// by typing the school's name; an export first is strongly suggested.
export default async function ResetPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ done?: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!ctx.can('tenant.manage')) return <Notice title={t('forbidden.title')} body={t('forbidden.body')} locale={locale} />;
  const counts = (await rpc<Record<string, number> | null>('tenant_counts', { p_tenant: tenant.id }, { token: ctx.token })) ?? {};
  const owner = ctx.membership?.roleKey === 'owner';
  const { done } = await searchParams;

  return (
    <Shell title={t('reset.title')} size="full" locale={locale}>
      <OwnerTabs base={base} t={t} can={(x) => ctx.can(x)} current="reset" />
      <div className="flex max-w-3xl flex-col gap-4">
        {done ? (
          <p role="status" className="card font-semibold text-on-surface">
            {t('reset.done')}
          </p>
        ) : null}
        <p className="text-sm">{t('reset.help')}</p>
        <section className="card flex flex-col gap-3" aria-labelledby="reset-title">
          <h2 id="reset-title" className="text-lg font-bold text-on-surface">
            {t('reset.what')}
          </h2>
          <p className="text-sm">{t('reset.counts', { conferences: counts.conferences ?? 0, committees: counts.committees ?? 0, delegates: counts.delegates ?? 0, grades: counts.grades ?? 0 })}</p>
          <p className="text-sm">
            <a className="font-semibold underline underline-offset-2" href={`${base}/owner/data`}>
              {t('reset.exportFirst')}
            </a>
          </p>
          {owner ? (
            (counts.conferences ?? 0) > 0 ? (
              <ActionForm action={resetSchoolAction.bind(null, key)} submitLabel={t('reset.submit')}>
                <label className="flex flex-col gap-1">
                  <span className="label">{t('reset.confirm', { name: tenant.name })}</span>
                  <input className="input" name="confirm" required autoComplete="off" />
                </label>
              </ActionForm>
            ) : (
              <p className="text-sm">{t('reset.nothing')}</p>
            )
          ) : (
            <p className="text-sm">{t('reset.ownerOnly')}</p>
          )}
        </section>
      </div>
    </Shell>
  );
}
