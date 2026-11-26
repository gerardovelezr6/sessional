import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { COPYABLE } from '@/billing/organisation';
import { SECTION_LABELS } from '@/config/registry';
import { tenantTranslator } from '@/config/store';
import { rpc } from '@/data/rpc';
import type { MessageKey } from '@/messages';
import { rootDomain, isSecureOrigin } from '@/platform/env';
import { OwnerNav } from '@/site/OwnerNav';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { addManagerAction, addSchoolAction } from '../billing/actions';
import { copySettingsAction } from './actions';

// Owner → Organization (Circuit plan): every school of the organization in one place, adding a
// school (billed on the same subscription), copying settings between schools, and who manages it.

interface Overview {
  id: string;
  name: string;
  plan: string | null;
  schools: { id: string; slug: string; name: string; status: string; manage: boolean; usage: { committees: number; delegates: number; staff: number } }[];
}

export default async function OrganisationPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ done?: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!ctx.can('tenant.manage')) return <Notice title={t('forbidden.title')} body={t('forbidden.body')} locale={locale} />;
  const org = await rpc<Overview | null>('organisation_overview', { p_tenant: tenant.id }, { token: ctx.token }).catch(() => null);
  const { done } = await searchParams;
  const scheme = isSecureOrigin() ? 'https' : 'http';

  return (
    <Shell title={t('organisation.title')} size="full" locale={locale}>
      <OwnerNav base={base} t={t} can={(x) => ctx.can(x)} current="organisation">
        {!org ? (
          <p className="card">{t('organisation.none')}</p>
        ) : (
          <div className="flex flex-col gap-5">
            {done ? (
              <p role="status" className="card font-semibold text-on-surface">
                {t(`organisation.done.${done}` as MessageKey)}
              </p>
            ) : null}
            <p className="text-sm">{t('organisation.help', { name: org.name })}</p>
            <section className="card flex flex-col gap-3" aria-labelledby="org-schools">
              <h2 id="org-schools" className="text-lg font-bold text-on-surface">
                {t('organisation.schools', { count: org.schools.length })}
              </h2>
              <div className="overflow-x-auto">
                <table className="table text-sm" aria-labelledby="org-schools">
                  <thead>
                    <tr>
                      <th scope="col">{t('organisation.col.school')}</th>
                      <th scope="col">{t('organisation.col.status')}</th>
                      <th scope="col">{t('organisation.col.committees')}</th>
                      <th scope="col">{t('organisation.col.delegates')}</th>
                      <th scope="col">{t('organisation.col.staff')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {org.schools.map((x) => (
                      <tr key={x.id}>
                        <td>
                          <a className="font-semibold text-on-surface underline-offset-2 hover:underline" href={`${scheme}://${x.slug}.${rootDomain()}/`}>
                            {x.name}
                          </a>
                          <span className="block font-mono text-xs" translate="no">
                            {`${x.slug}.${rootDomain()}`}
                          </span>
                        </td>
                        <td>{t(`organisation.status.${x.status}` as MessageKey)}</td>
                        <td className="tabular-nums">{x.usage.committees}</td>
                        <td className="tabular-nums">{x.usage.delegates}</td>
                        <td className="tabular-nums">{x.usage.staff}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="card flex flex-col gap-3" aria-labelledby="org-add">
              <h2 id="org-add" className="text-lg font-bold text-on-surface">
                {t('organisation.add.title')}
              </h2>
              <p className="text-sm">{t('organisation.add.help')}</p>
              <ActionForm action={addSchoolAction.bind(null, key)} submitLabel={t('organisation.add.submit')}>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="flex flex-col gap-1">
                    <span className="label">{t('organisation.add.name')}</span>
                    <input className="input" name="name" required maxLength={120} autoComplete="off" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="label">{t('organisation.add.slug')}</span>
                    <input className="input font-mono" name="slug" required maxLength={40} pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]" autoComplete="off" spellCheck={false} />
                    <span className="text-xs">{t('organisation.add.slugHelp', { root: rootDomain() })}</span>
                  </label>
                </div>
              </ActionForm>
            </section>

            <section className="card flex flex-col gap-3" aria-labelledby="org-copy">
              <h2 id="org-copy" className="text-lg font-bold text-on-surface">
                {t('organisation.copy.title')}
              </h2>
              <p className="text-sm">{t('organisation.copy.help')}</p>
              <ActionForm action={copySettingsAction.bind(null, key)} submitLabel={t('organisation.copy.submit')}>
                <label className="flex flex-col gap-1">
                  <span className="label">{t('organisation.copy.from')}</span>
                  <select className="input" name="source" defaultValue={tenant.id}>
                    {org.schools
                      .filter((x) => x.manage)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                  </select>
                </label>
                <fieldset className="flex flex-col gap-1">
                  <legend className="label">{t('organisation.copy.to')}</legend>
                  {org.schools
                    .filter((x) => x.manage)
                    .map((x) => (
                      <label key={x.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="target" value={x.id} />
                        {x.name}
                      </label>
                    ))}
                </fieldset>
                <fieldset className="flex flex-col gap-1">
                  <legend className="label">{t('organisation.copy.what')}</legend>
                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
                    {COPYABLE.map((section) => (
                      <label key={section} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="section" value={section} />
                        {t(SECTION_LABELS[section])}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </ActionForm>
            </section>

            <section className="card flex flex-col gap-3" aria-labelledby="org-managers">
              <h2 id="org-managers" className="text-lg font-bold text-on-surface">
                {t('organisation.managers.title')}
              </h2>
              <p className="text-sm">{t('organisation.managers.help')}</p>
              <ActionForm action={addManagerAction.bind(null, key)} submitLabel={t('organisation.managers.submit')}>
                <label className="flex flex-col gap-1">
                  <span className="label">{t('organisation.managers.email')}</span>
                  <input className="input" type="email" name="email" required autoComplete="off" spellCheck={false} />
                </label>
              </ActionForm>
            </section>
          </div>
        )}
      </OwnerNav>
    </Shell>
  );
}
