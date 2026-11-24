import { redirect } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { moduleOn } from '@/config/modules';
import { tenantTranslator } from '@/config/store';
import type { MessageKey } from '@/messages';
import { AdminTabs } from '@/site/AdminTabs';
import { ADMIN_PERMISSIONS } from '@/site/nav';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { loadOverview } from '../committees/data';

// High Command → Print: every printable in the school's look, for one committee or all of them.
// Chairs reach the same files from here for the committees they run.

interface Printable {
  kind: string;
  title: MessageKey;
  body: MessageKey;
  committee: boolean;
  extra?: 'sessions' | 'type';
  may: (can: (p: string) => boolean) => boolean;
  module?: 'schedule' | 'documents' | 'grading';
}

const PRINTABLES: Printable[] = [
  { kind: 'placards', title: 'print.placards.title', body: 'print.placards.body', committee: true, may: (can) => can('committee.manage') || can('committee.run') },
  { kind: 'signin', title: 'print.signin.title', body: 'print.signin.body', committee: true, extra: 'sessions', may: (can) => can('committee.manage') || can('committee.run') },
  { kind: 'agenda', title: 'print.agenda.title', body: 'print.agenda.body', committee: false, may: () => true, module: 'schedule' },
  { kind: 'resolutions', title: 'print.resolutions.title', body: 'print.resolutions.body', committee: true, may: (can) => can('committee.manage') || can('committee.run'), module: 'documents' },
  { kind: 'certificates', title: 'print.certificates.title', body: 'print.certificates.body', committee: true, extra: 'type', may: (can) => can('committee.manage') || can('grades.view') },
  { kind: 'grades', title: 'print.grades.title', body: 'print.grades.body', committee: false, may: (can) => can('grades.view'), module: 'grading' },
];

export default async function PrintPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale, config } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!ctx.membership) redirect(`${base}/`);
  const can = (p: string) => ctx.can(p);
  const list = PRINTABLES.filter((p) => p.may(can) && (!p.module || moduleOn(config, p.module)));
  if (!list.length) return <Notice title={t('forbidden.title')} body={t('forbidden.body')} locale={locale} />;
  const { committees } = await loadOverview(tenant.id, ctx.token);
  const mine = ctx.can('committee.manage') ? committees : committees.filter((c) => c.is_chair);

  return (
    <Shell title={t('print.title')} size="full" locale={locale}>
      {ADMIN_PERMISSIONS.some(can) ? <AdminTabs base={base} t={t} can={can} current="print" /> : null}
      <p className="mb-2 max-w-3xl text-sm">{t('print.help')}</p>
      {ctx.can('tenant.manage') ? (
        <p className="mb-5">
          <a className="text-sm font-semibold underline underline-offset-2" href={`${base}/settings?section=printing`}>
            {t('print.style')}
          </a>
        </p>
      ) : (
        <div className="mb-5" />
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.map((p) => (
          <form key={p.kind} method="get" action={`${base}/print/${p.kind}`} target="_blank" className="card flex flex-col gap-3" aria-labelledby={`print-${p.kind}`}>
            <h2 id={`print-${p.kind}`} className="text-lg font-bold text-on-surface">
              {t(p.title)}
            </h2>
            <p className="flex-1 text-sm">{t(p.body)}</p>
            {p.committee ? (
              <label className="flex flex-col gap-1">
                <span className="label">{t('print.committee')}</span>
                <select className="input" name="committee" defaultValue="all">
                  {ctx.can('committee.manage') || p.kind === 'certificates' ? <option value="all">{t('print.allCommittees')}</option> : null}
                  {mine.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.abbreviation ? `${c.abbreviation} · ${c.name}` : c.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {p.extra === 'sessions' ? (
              <label className="flex flex-col gap-1">
                <span className="label">{t('print.sessions')}</span>
                <input className="input" name="sessions" type="number" min={1} max={8} defaultValue={4} />
              </label>
            ) : null}
            {p.extra === 'type' ? (
              <label className="flex flex-col gap-1">
                <span className="label">{t('print.certificates.which')}</span>
                <select className="input" name="type" defaultValue={ctx.can('committee.manage') ? 'participation' : 'awards'}>
                  {ctx.can('committee.manage') ? <option value="participation">{t('print.certificates.participation')}</option> : null}
                  {ctx.can('grades.view') && moduleOn(config, 'grading') ? <option value="awards">{t('print.certificates.awards')}</option> : null}
                </select>
              </label>
            ) : null}
            <div>
              <button type="submit" className="btn btn-primary" aria-label={t('print.open', { name: t(p.title) })}>
                {t('print.download')}
              </button>
            </div>
          </form>
        ))}
      </div>
    </Shell>
  );
}
