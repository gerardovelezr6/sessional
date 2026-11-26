import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { ConfirmButton } from '@/components/ConfirmButton';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { tenantTranslator } from '@/config/store';
import { rpc } from '@/data/rpc';
import { regional } from '@/i18n/regional';
import type { MessageKey } from '@/messages';
import { rootDomain } from '@/platform/env';
import { hostingConfigured } from '@/platform/hosting';
import { OwnerNav } from '@/site/OwnerNav';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { addDomainAction, checkDomainAction, primaryDomainAction, removeDomainAction } from './actions';

// Owner → Domains: the school's own address (mun.school.edu). Each record to create is shown next to
// what a live DNS lookup finds right now; the domain serves, over HTTPS, once both agree.

interface DomainRow {
  host: string;
  status: 'pending' | 'verified' | 'error';
  primary: boolean;
  records: { type: string; name: string; value: string; found: string[]; ok: boolean }[];
  checked_at: string | null;
  problem: string | null;
}

const PROBLEMS = ['hosting', 'dns', 'propagating'];

export default async function DomainsPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ done?: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!ctx.can('tenant.manage')) return <Notice title={t('forbidden.title')} body={t('forbidden.body')} locale={locale} />;
  const [domains, features] = await Promise.all([
    rpc<DomainRow[] | null>('domain_list', { p_tenant: tenant.id }, { token: ctx.token }).then((d) => d ?? []),
    rpc<{ custom_domain: boolean } | null>('tenant_features', { p_tenant: tenant.id }, { token: ctx.token }),
  ]);
  const { done } = await searchParams;
  const when = new Intl.DateTimeFormat(regional(locale), { dateStyle: 'medium', timeStyle: 'short' });
  const primary = domains.find((d) => d.primary);

  return (
    <Shell title={t('domains.title')} size="full" locale={locale}>
      <OwnerNav base={base} t={t} can={(x) => ctx.can(x)} current={'domains'}>
      <div className="flex max-w-5xl flex-col gap-5">
        {done ? (
          <p role="status" className="card font-semibold text-on-surface">
            {t(`domains.done.${done}` as MessageKey)}
          </p>
        ) : null}
        <p className="text-sm">{t('domains.help', { address: `${tenant.slug}.${rootDomain()}` })}</p>
        <p className="text-sm">
          {t('domains.primaryNow')}{' '}
          <strong className="font-mono text-on-surface" translate="no">
            {primary?.host ?? `${tenant.slug}.${rootDomain()}`}
          </strong>
        </p>
        {!features?.custom_domain ? (
          <p className="card">
            {t('domains.plan')}{' '}
            <a className="font-semibold underline underline-offset-2" href={`${base}/owner/billing`}>
              {t('domains.planLink')}
            </a>
          </p>
        ) : (
          <section className="card flex flex-col gap-3" aria-labelledby="add-domain">
            <h2 id="add-domain" className="text-lg font-bold text-on-surface">
              {t('domains.add')}
            </h2>
            {!hostingConfigured() ? <p className="text-sm">{t('domains.hostingMissing')}</p> : null}
            <ActionForm action={addDomainAction.bind(null, key)} submitLabel={t('domains.addButton')}>
              <label className="flex flex-col gap-1">
                <span className="label">{t('domains.host')}</span>
                <input className="input font-mono" name="host" required maxLength={253} placeholder={t('domains.hostExample')} autoComplete="off" spellCheck={false} inputMode="url" />
              </label>
            </ActionForm>
          </section>
        )}

        {domains.map((d) => (
          <section key={d.host} className="card flex flex-col gap-3" aria-labelledby={`d-${d.host}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`d-${d.host}`} className="font-mono text-lg font-bold text-on-surface" translate="no">
                {d.host}
              </h2>
              <span className={`badge ${d.status === 'verified' ? 'tone-live' : d.status === 'error' ? 'tone-danger' : 'tone-paused'}`}>
                {t(`domains.status.${d.status}`)}
                {d.primary ? ` · ${t('domains.primary')}` : ''}
              </span>
            </div>
            <p className="text-sm">
              {d.status === 'verified'
                ? t('domains.verifiedBody')
                : d.problem && PROBLEMS.includes(d.problem)
                  ? t(`domains.problem.${d.problem}` as MessageKey)
                  : d.problem
                    ? t('domains.problem.other', { detail: d.problem })
                    : t('domains.problem.dns')}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <caption className="pb-2 text-start font-semibold text-on-surface">{t('domains.records')}</caption>
                <thead>
                  <tr className="border-b border-border-strong">
                    {(['type', 'name', 'value', 'found', 'ok'] as const).map((c) => (
                      <th key={c} scope="col" className="label-text p-2 text-start">
                        {t(`domains.col.${c}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.records.map((r) => (
                    <tr key={`${r.type}-${r.name}-${r.value}`} className="border-b border-border align-top">
                      <td className="p-2 font-mono">{r.type}</td>
                      <td className="p-2 font-mono break-all" translate="no">
                        {r.name}
                      </td>
                      <td className="p-2 font-mono break-all" translate="no">
                        {r.value}
                      </td>
                      <td className="p-2 font-mono break-all" translate="no">
                        {r.found.length ? r.found.join(', ') : t('domains.nothing')}
                      </td>
                      <td className="p-2 font-semibold text-on-surface">{t(r.ok ? 'domains.match' : 'domains.noMatch')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs">{d.checked_at ? t('domains.checkedAt', { when: when.format(new Date(d.checked_at)) }) : t('domains.notChecked')}</p>
            <div className="flex flex-wrap gap-2">
              <ActionForm action={checkDomainAction.bind(null, key, d.host)} submitLabel={t('domains.check')} variant="secondary" />
              {d.status === 'verified' && !d.primary ? <ActionForm action={primaryDomainAction.bind(null, key, d.host)} submitLabel={t('domains.makePrimary')} variant="secondary" /> : null}
              {d.primary ? <ActionForm action={primaryDomainAction.bind(null, key, null)} submitLabel={t('domains.useSubdomain')} variant="secondary" /> : null}
              <ConfirmButton action={removeDomainAction.bind(null, key, d.host)} ask={t('domains.remove')} confirm={t('domains.removeConfirm')} cancel={t('platform.school.keep')} />
            </div>
          </section>
        ))}
      </div>
      </OwnerNav>
    </Shell>
  );
}
