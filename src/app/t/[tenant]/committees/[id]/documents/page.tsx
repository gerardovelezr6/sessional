import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { ConfirmButton } from '@/components/ConfirmButton';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { tenantTranslator } from '@/config/store';
import { rpc } from '@/data/rpc';
import { localize, type MessageKey } from '@/messages';
import { protocolFor } from '@/protocol/run';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { loadCommittee } from '../../data';
import { deleteDocumentAction, saveDocumentAction, setDocumentStatusAction } from './actions';
import { NEXT, type DocumentRow, type DocStatus } from './rules';

const ORDER: DocStatus[] = ['introduced', 'approved', 'submitted', 'draft', 'passed', 'failed', 'withdrawn'];

export default async function DocumentsPage({ params, searchParams }: { params: Promise<{ tenant: string; id: string }>; searchParams: Promise<{ done?: string }> }) {
  const { tenant: key, id } = await params;
  const tenant = await requireTenant(key);
  const { t, locale, config } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  const detail = await loadCommittee(tenant.id, id, ctx.token);
  if (!detail) notFound();
  const canRun = await rpc<boolean>('committee_can_run', { p_committee: id }, { token: ctx.token });
  if (!canRun) return <Notice title={t('forbidden.title')} body={t('forbidden.body')} locale={locale} />;

  const pack = protocolFor(null, config.protocol);
  const docs = (await rpc<DocumentRow[]>('documents_list', { p_committee: id }, { token: ctx.token })).sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.created_at.localeCompare(b.created_at));
  const { done } = await searchParams;
  const label = new Map(detail.delegates.map((d) => [d.id, d.label]));
  const kindName = (k: string) => localize(pack.documents.find((x) => x.key === k)?.name, locale, k);
  const names = (list: string[]) => list.map((x) => label.get(x) ?? '—').join(', ') || '—';

  // The form for a new document and for editing a draft.
  const fields = (doc?: DocumentRow) => (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {doc ? null : (
        <label className="flex flex-col gap-1">
          <span className="label">{t('documents.field.kind')}</span>
          <select className="input" name="kind" required>
            {pack.documents.map((k) => (
              <option key={k.key} value={k.key}>
                {localize(k.name, locale, k.key)}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1">
        <span className="label">{t('documents.field.code')}</span>
        <input className="input" name="code" maxLength={20} defaultValue={doc?.code ?? ''} placeholder="1.1" />
      </label>
      <label className="flex flex-col gap-1 md:col-span-2">
        <span className="label">{t('documents.field.title')}</span>
        <input className="input" name="title" required maxLength={200} defaultValue={doc?.title ?? ''} />
      </label>
      {doc ? null : pack.documents.some((k) => k.amends) && docs.length ? (
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="label">{t('documents.field.parent')}</span>
          <select className="input" name="parent" defaultValue="">
            <option value="">{t('documents.field.parent.none')}</option>
            {docs
              .filter((d) => !d.parent_id)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {`${d.code ? `${d.code} ` : ''}${d.title}`}
                </option>
              ))}
          </select>
        </label>
      ) : null}
      {(['sponsor', 'signatory'] as const).map((role) => (
        <fieldset key={role} className="flex flex-col gap-1">
          <legend className="label">{t(role === 'sponsor' ? 'documents.field.sponsors' : 'documents.field.signatories')}</legend>
          <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-control border border-border p-2">
            {detail.delegates.map((d) => (
              <label key={d.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name={role} value={d.id} defaultChecked={(role === 'sponsor' ? doc?.sponsors : doc?.signatories)?.includes(d.id)} />
                {d.label}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <label className="flex flex-col gap-1 md:col-span-2">
        <span className="label">{t('documents.field.body')}</span>
        <textarea className="input min-h-40" name="body" maxLength={20000} defaultValue={doc?.body ?? ''} />
      </label>
    </div>
  );

  return (
    <Shell title={t('documents.title', { name: detail.committee.name })} size="full" locale={locale}>
      <div className="flex flex-col gap-6">
        <p className="flex flex-wrap gap-4 text-sm font-semibold">
          <Link href={`${base}/committees/${id}`} className="underline underline-offset-2">
            {t('console.back')}
          </Link>
          <Link href={`${base}/committees/${id}/console`} className="underline underline-offset-2">
            {t('committee.console.open')}
          </Link>
        </p>
        {done ? (
          <p role="status" className="card font-semibold text-on-surface">
            {t(done === 'deleted' ? 'documents.deleted' : 'documents.saved')}
          </p>
        ) : null}
        {pack.documents.length === 0 ? <p className="card">{t('documents.noKinds')}</p> : null}

        {docs.length === 0 ? <p className="card">{t('documents.empty')}</p> : null}
        <ul className="flex flex-col gap-4" aria-label={t('documents.list')}>
          {docs.map((d) => {
            const kind = pack.documents.find((k) => k.key === d.kind);
            const parent = d.parent_id ? docs.find((x) => x.id === d.parent_id) : null;
            return (
              <li key={d.id} id={`doc-${d.id}`} className="card flex flex-col gap-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-lg font-bold text-on-surface">
                    {d.code ? `${d.code} · ` : ''}
                    {d.title}
                  </h2>
                  <span className="rounded-control border border-border-strong px-2 text-sm font-semibold text-on-surface">{t(`documents.status.${d.status}` as MessageKey)}</span>
                </div>
                <p className="text-sm text-on-surface-muted">
                  {kindName(d.kind)}
                  {parent ? ` · ${t('documents.amends', { title: parent.title })}` : ''}
                </p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="font-semibold text-on-surface">{t('documents.field.sponsors')}</dt>
                  <dd>
                    {names(d.sponsors)}
                    {kind ? <span className="text-on-surface-muted"> {t('documents.needs', { count: kind.minSponsors })}</span> : null}
                  </dd>
                  <dt className="font-semibold text-on-surface">{t('documents.field.signatories')}</dt>
                  <dd>
                    {names(d.signatories)}
                    {kind ? <span className="text-on-surface-muted"> {t('documents.needs', { count: kind.minSignatories })}</span> : null}
                  </dd>
                </dl>
                {d.body ? (
                  <details>
                    <summary className="cursor-pointer text-sm font-semibold text-on-surface">{t('documents.field.body')}</summary>
                    <p className="mt-2 whitespace-pre-line text-sm">{d.body}</p>
                  </details>
                ) : null}
                <div className="flex flex-wrap items-start gap-2">
                  {NEXT[d.status]
                    .filter((s) => s !== 'withdrawn' && (s !== 'introduced' || kind?.votable))
                    .map((s) => (
                      <div key={s}>
                        <ActionForm action={setDocumentStatusAction.bind(null, key, id, d.id, s)} submitLabel={t(`documents.to.${s}` as MessageKey)} variant={s === 'draft' ? 'secondary' : 'primary'} />
                      </div>
                    ))}
                  {NEXT[d.status].includes('withdrawn') ? (
                    <ConfirmButton action={setDocumentStatusAction.bind(null, key, id, d.id, 'withdrawn')} ask={t('documents.to.withdrawn')} confirm={t('documents.withdraw.confirm')} cancel={t('documents.keep')} />
                  ) : null}
                  {d.status === 'draft' || d.status === 'withdrawn' ? (
                    <ConfirmButton action={deleteDocumentAction.bind(null, key, id, d.id)} ask={t('documents.delete')} confirm={t('documents.delete.confirm')} cancel={t('documents.keep')} />
                  ) : null}
                </div>
                {d.status === 'draft' || d.status === 'submitted' ? (
                  <details className="rounded-control border border-border p-3">
                    <summary className="cursor-pointer font-semibold text-on-surface">{t('documents.edit')}</summary>
                    <div className="mt-3">
                      <ActionForm action={saveDocumentAction.bind(null, key, id, d.id)} submitLabel={t('documents.save')} variant="secondary">
                        {fields(d)}
                      </ActionForm>
                    </div>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>

        {pack.documents.length ? (
          <section className="card flex flex-col gap-3" aria-labelledby="new-doc">
            <h2 id="new-doc" className="text-lg font-bold text-on-surface">
              {t('documents.new')}
            </h2>
            <ActionForm action={saveDocumentAction.bind(null, key, id, null)} submitLabel={t('documents.create')}>
              {fields()}
            </ActionForm>
          </section>
        ) : null}
      </div>
    </Shell>
  );
}
