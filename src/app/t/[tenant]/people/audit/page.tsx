import { redirect } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { tenantTranslator } from '@/config/store';
import { rpc } from '@/data/rpc';
import { catalogs, type MessageKey } from '@/messages';
import { OwnerTabs } from '@/site/AdminTabs';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';

// The school's audit log: who changed what, and when. Newest first, fifty at a time, filtered by
// kind of change. Details of grades and documents show only to those who may read them.

interface Entry {
  id: number;
  action: string;
  target: string | null;
  target_name: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
  actor_id: string | null;
  actor_name: string | null;
  impersonated: boolean;
}
const PAGE = 50;
const KIND = /^[a-z_]{1,40}$/;

export default async function AuditPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ kind?: string; before?: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale, config } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!ctx.can('audit.view')) return <Notice title={t('forbidden.title')} body={t('forbidden.body')} locale={locale} />;

  const q = await searchParams;
  const kind = q.kind && KIND.test(q.kind) ? q.kind : null;
  const before = q.before && /^\d{1,18}$/.test(q.before) ? q.before : null;
  const log = await rpc<{ entries: Entry[]; actions: string[] } | null>('audit_list', { p_tenant: tenant.id, p_before: before, p_action: kind, p_actor: null, p_limit: PAGE }, { token: ctx.token });
  const entries = log?.entries ?? [];
  const known = new Set(Object.keys(catalogs.en));
  const tableWord = (table: string) => (known.has(`audit.table.${table}`) ? t(`audit.table.${table}` as MessageKey) : table);
  const what = (action: string) => {
    const [table = '', op = ''] = action.split('.');
    return known.has(`audit.op.${op}`) ? t(`audit.op.${op}` as MessageKey, { what: tableWord(table) }) : action;
  };
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium', timeZone: config.identity.timeZone });
  const link = (k: string | null, b: string | null) => `${base}/people/audit${k || b ? `?${new URLSearchParams({ ...(k ? { kind: k } : {}), ...(b ? { before: b } : {}) })}` : ''}`;

  return (
    <Shell title={t('audit.title')} size="full" locale={locale}>
      <OwnerTabs base={base} t={t} can={(x) => ctx.can(x)} current="audit" />
      <div className="flex flex-col gap-4">
        <p className="text-sm">{t('audit.help')}</p>
        <nav aria-label={t('audit.filter')} className="flex flex-wrap gap-1">
          <a href={link(null, null)} className="chip" aria-current={!kind ? 'page' : undefined}>
            {t('audit.all')}
          </a>
          {(log?.actions ?? []).sort().map((a) => (
            <a key={a} href={link(a, null)} className="chip" aria-current={kind === a ? 'page' : undefined}>
              {tableWord(a)}
            </a>
          ))}
        </nav>
        <section className="card overflow-x-auto">
          {entries.length === 0 ? <p className="text-sm">{t('audit.none')}</p> : null}
          <table className="w-full text-sm" aria-label={t('audit.title')}>
            <thead>
              <tr className="border-b border-border-strong">
                <th scope="col" className="label-text p-2 text-start">{t('audit.when')}</th>
                <th scope="col" className="label-text p-2 text-start">{t('audit.who')}</th>
                <th scope="col" className="label-text p-2 text-start">{t('audit.what')}</th>
                <th scope="col" className="label-text p-2 text-start">{t('audit.target')}</th>
                <th scope="col" className="label-text p-2 text-start">{t('audit.details')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-border align-top">
                  <td className="whitespace-nowrap p-2">{when.format(new Date(e.created_at))}</td>
                  <td className="p-2 font-semibold text-on-surface">
                    {e.actor_name ?? (e.impersonated ? t('audit.platform') : e.actor_id ? t('audit.formerMember') : t('audit.system'))}
                    {e.impersonated ? <span className="block text-xs font-normal">{t('audit.impersonated')}</span> : null}
                  </td>
                  <td className="p-2">{what(e.action)}</td>
                  <td className="p-2">{e.target_name ?? e.target ?? '—'}</td>
                  <td className="p-2">
                    {e.meta ? (
                      <details>
                        <summary className="cursor-pointer text-xs">{t('audit.show')}</summary>
                        <pre className="mt-1 max-w-xl overflow-x-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(e.meta, null, 1)}</pre>
                      </details>
                    ) : (
                      <span className="text-xs">{t('audit.hidden')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {entries.length === PAGE ? (
            <p className="mt-3">
              <a className="btn btn-secondary" href={link(kind, String(entries.at(-1)!.id))}>
                {t('audit.older')}
              </a>
            </p>
          ) : null}
        </section>
      </div>
    </Shell>
  );
}
