import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { ConfirmButton } from '@/components/ConfirmButton';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { tenantTranslator } from '@/config/store';
import { rpc } from '@/data/rpc';
import { DOCUMENT_MAX_BYTES, DOCUMENT_TYPES } from '@/documents/files';
import { sizeOf, type ConferenceDocument } from '@/documents/format';
import type { MessageKey } from '@/messages';
import { AdminTabs } from '@/site/AdminTabs';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { addDocumentAction, audienceAction, removeDocumentAction } from './actions';

// High Command → Documents: files for the whole conference (rules of procedure, the delegate
// handbook, the schedule), each for staff, every member, or the public pages.

export default async function DocumentsAdmin({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ done?: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!ctx.can('committee.manage')) return <Notice title={t('forbidden.title')} body={t('forbidden.body')} locale={locale} />;
  const docs = (await rpc<ConferenceDocument[] | null>('conference_documents_list', { p_tenant: tenant.id }, { token: ctx.token }).catch(() => null)) ?? [];
  const { done } = await searchParams;

  return (
    <Shell title={t('admin.tab.documents')} size="full" locale={locale}>
      <AdminTabs base={base} t={t} can={(x) => ctx.can(x)} current="documents" />
      <div className="flex max-w-5xl flex-col gap-5">
        {done ? (
          <p role="status" className="card font-semibold text-on-surface">
            {t(`confdocs.done.${done}` as MessageKey)}
          </p>
        ) : null}
        <p className="text-sm">{t('confdocs.help')}</p>
        <section className="card flex flex-col gap-3" aria-labelledby="docs-list">
          <h2 id="docs-list" className="text-lg font-bold text-on-surface">
            {t('confdocs.list', { count: docs.length })}
          </h2>
          {docs.length ? (
            <div className="overflow-x-auto">
              <table className="table text-sm" aria-labelledby="docs-list">
                <thead>
                  <tr>
                    <th scope="col">{t('confdocs.col.title')}</th>
                    <th scope="col">{t('confdocs.col.file')}</th>
                    <th scope="col">{t('confdocs.col.audience')}</th>
                    <th scope="col">
                      <span className="sr-only">{t('confdocs.col.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <a className="font-semibold text-on-surface underline-offset-2 hover:underline" href={`${base}/documents/${d.id}`}>
                          {d.title}
                        </a>
                        {d.description ? <span className="block text-xs">{d.description}</span> : null}
                      </td>
                      <td>
                        <span className="block break-all">{d.file_name}</span>
                        <span className="block text-xs">{sizeOf(d.size_bytes, locale)}</span>
                      </td>
                      <td>
                        <ActionForm action={audienceAction.bind(null, key, d.id)} submitLabel={t('confdocs.audience.save')} variant="secondary">
                          <label className="sr-only" htmlFor={`aud-${d.id}`}>
                            {t('confdocs.col.audience')}
                          </label>
                          <select id={`aud-${d.id}`} className="input w-auto" name="audience" defaultValue={d.audience}>
                            {(['staff', 'members', 'public'] as const).map((a) => (
                              <option key={a} value={a}>
                                {t(`confdocs.audience.${a}`)}
                              </option>
                            ))}
                          </select>
                        </ActionForm>
                      </td>
                      <td>
                        <ConfirmButton action={removeDocumentAction.bind(null, key, d.id)} ask={t('confdocs.remove')} confirm={t('confdocs.removeConfirm', { title: d.title })} cancel={t('platform.school.keep')} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm">{t('confdocs.none')}</p>
          )}
        </section>
        <section className="card flex flex-col gap-3" aria-labelledby="docs-add">
          <h2 id="docs-add" className="text-lg font-bold text-on-surface">
            {t('confdocs.add')}
          </h2>
          <ActionForm action={addDocumentAction.bind(null, key)} submitLabel={t('confdocs.upload')}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="label">{t('confdocs.field.file')}</span>
                <input className="text-sm" type="file" name="file" required accept={Object.keys(DOCUMENT_TYPES).join(',')} />
                <span className="text-xs">{t('confdocs.field.fileHelp', { mb: DOCUMENT_MAX_BYTES / 1024 / 1024 })}</span>
              </label>
              <label className="flex flex-col gap-1">
                <span className="label">{t('confdocs.field.title')}</span>
                <input className="input" name="title" maxLength={160} autoComplete="off" />
                <span className="text-xs">{t('confdocs.field.titleHelp')}</span>
              </label>
              <label className="flex flex-col gap-1 md:col-span-2">
                <span className="label">{t('confdocs.field.description')}</span>
                <input className="input" name="description" maxLength={500} autoComplete="off" />
              </label>
              <fieldset className="flex flex-col gap-1 md:col-span-2">
                <legend className="label">{t('confdocs.col.audience')}</legend>
                {(['members', 'staff', 'public'] as const).map((a) => (
                  <label key={a} className="flex items-start gap-2 text-sm">
                    <input type="radio" name="audience" value={a} defaultChecked={a === 'members'} className="mt-1" />
                    <span>
                      <span className="font-semibold text-on-surface">{t(`confdocs.audience.${a}`)}</span> · {t(`confdocs.audience.${a}.help`)}
                    </span>
                  </label>
                ))}
              </fieldset>
            </div>
          </ActionForm>
        </section>
      </div>
    </Shell>
  );
}
