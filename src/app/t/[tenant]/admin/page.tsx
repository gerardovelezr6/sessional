import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AutoRefresh } from '@/components/AutoRefresh';
import { Notice } from '@/components/Notice';
import { PoweredBy } from '@/components/PoweredBy';
import { tenantTranslator } from '@/config/store';
import { rpc } from '@/data/rpc';
import { localize } from '@/messages';
import { AdminTabs } from '@/site/AdminTabs';
import { ADMIN_PERMISSIONS } from '@/site/nav';
import { siteOf } from '@/site/rules';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { regional } from '@/i18n/regional';

// The High Command page: the current conference, live. Counts only, no names; refreshed every
// fifteen seconds while the page is open.

interface CommitteeLive {
  id: string;
  name: string;
  abbreviation: string;
  status: { status: 'in_session' | 'between_sessions' | 'not_started'; session_number: number | null; mode: string | null } | null;
  members: number;
  present: number;
  sessions: number;
  speeches: number;
  speaking_seconds: number;
  motions: number;
  points: number;
  votes: number;
  passed: number;
  warnings: number;
  documents: number;
  grades: number | null;
  last_activity: string | null;
}

export default async function AdminPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale, config } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  const can = (p: string) => ctx.can(p);
  if (!ADMIN_PERMISSIONS.some(can)) return <Notice title={t('forbidden.title')} body={t('forbidden.body')} locale={locale} />;

  const site = siteOf(config);
  const data = await rpc<{ conference: { id: string; name: string } | null; at: string; committees: CommitteeLive[] } | null>('conference_analytics', { p_tenant: tenant.id }, { token: ctx.token }).catch(() => null);
  const rows = data?.committees ?? [];
  const sum = (k: keyof Pick<CommitteeLive, 'members' | 'present' | 'speeches' | 'speaking_seconds' | 'motions' | 'points' | 'votes' | 'passed' | 'warnings' | 'documents'>) => rows.reduce((n, c) => n + c[k], 0);
  const live = rows.filter((c) => c.status?.status === 'in_session').length;
  const grades = rows.some((c) => c.grades !== null) ? rows.reduce((n, c) => n + (c.grades ?? 0), 0) : null;
  const minutes = (s: number) => Math.round(s / 60);
  const time = new Intl.DateTimeFormat(regional(locale), { timeStyle: 'medium', timeZone: config.identity.timeZone });
  const ago = new Intl.RelativeTimeFormat(regional(locale), { numeric: 'auto' });
  const at = data ? Date.parse(data.at) : 0;
  const sinceText = (iso: string | null) => (iso ? ago.format(-Math.max(0, Math.round((at - Date.parse(iso)) / 60000)), 'minute') : '—');
  // While a committee sits, "3 minutes ago" says it is alive; once paused or over, the moment it
  // stopped is fixed, so it is shown as a time that doesn't keep counting.
  const sameDay = new Intl.DateTimeFormat('en-CA', { timeZone: config.identity.timeZone });
  const stamp = new Intl.DateTimeFormat(regional(locale), { hour: 'numeric', minute: '2-digit', timeZone: config.identity.timeZone });
  const stampDay = new Intl.DateTimeFormat(regional(locale), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: config.identity.timeZone });
  const lastText = (c: CommitteeLive) => {
    if (!c.last_activity) return '—';
    if (c.status?.status === 'in_session') return sinceText(c.last_activity);
    const when = new Date(c.last_activity);
    return (sameDay.format(when) === sameDay.format(new Date(at)) ? stamp : stampDay).format(when).replace(/[\u202f\u2009]/g, '\u00a0');
  };
  const stats: { label: string; value: string }[] = [
    { label: t('admin.stat.inSession'), value: `${live} / ${rows.length}` },
    { label: t('admin.stat.present'), value: `${sum('present')} / ${sum('members')}` },
    { label: t('admin.stat.speeches'), value: `${sum('speeches')}` },
    { label: t('admin.stat.speakingMinutes'), value: `${minutes(sum('speaking_seconds'))}` },
    { label: t('admin.stat.motions'), value: `${sum('motions')}` },
    { label: t('admin.stat.votes'), value: t('conferences.passedOf', { passed: sum('passed'), total: sum('votes') }) },
    { label: t('admin.stat.warnings'), value: `${sum('warnings')}` },
    ...(grades !== null ? [{ label: t('admin.stat.grades'), value: `${grades}` }] : []),
  ];

  return (
    <main id="main" className="flex flex-1 flex-col items-center px-4 py-8">
      <AutoRefresh seconds={15} />
      <div className="w-full max-w-7xl">
        <h1 className="page-title text-2xl">{localize(site.admin.title, locale) || t('nav.admin')}</h1>
        <p className="mb-5 mt-3 text-sm">{localize(site.admin.subtitle, locale) || t('admin.subtitle')}</p>
        <AdminTabs base={base} t={t} can={can} current="analytics" />
        {!data?.conference ? (
          <p className="placeholder text-sm">{t('admin.noConference')}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm">{t('admin.liveFor', { name: data.conference.name, time: time.format(new Date(at)) })}</p>
            <section aria-label={t('admin.tab.analytics')} className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {stats.map((s) => (
                <div key={s.label} className="stat">
                  <span className="label-text">{s.label}</span>
                  <span className="stat-value">{s.value}</span>
                </div>
              ))}
            </section>
            <section className="card overflow-x-auto" aria-labelledby="live-title">
              <h2 id="live-title" className="mb-3 text-lg font-bold text-on-surface">
                {t('admin.byCommittee')}
              </h2>
              <table className="w-full text-sm" aria-labelledby="live-title">
                <thead>
                  <tr className="border-b border-border-strong">
                    <th scope="col" className="label-text p-2 text-start">{t('conferences.col.committee')}</th>
                    <th scope="col" className="label-text p-2 text-start">{t('conferences.col.status')}</th>
                    <th scope="col" className="label-text p-2 text-end">{t('admin.stat.present')}</th>
                    <th scope="col" className="label-text p-2 text-end">{t('admin.stat.speeches')}</th>
                    <th scope="col" className="label-text p-2 text-end">{t('admin.stat.motions')}</th>
                    <th scope="col" className="label-text p-2 text-end">{t('admin.stat.votes')}</th>
                    <th scope="col" className="label-text p-2 text-end">{t('admin.stat.warnings')}</th>
                    {grades !== null ? <th scope="col" className="label-text p-2 text-end">{t('admin.stat.grades')}</th> : null}
                    <th scope="col" className="label-text p-2 text-start">{t('admin.lastActivity')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id} className="border-b border-border">
                      <td className="p-2">
                        <Link className="font-semibold text-on-surface underline-offset-2 hover:underline" href={`${base}/committees/${c.id}`}>
                          {c.abbreviation || c.name}
                        </Link>
                      </td>
                      <td className="p-2">
                        <span className={`badge ${c.status?.status === 'in_session' ? 'tone-live' : c.status?.status === 'between_sessions' ? 'tone-paused' : 'tone-idle'}`}>
                          {t(`home.status.${c.status?.status ?? 'not_started'}`)}
                          {c.status?.status === 'in_session' && c.status.session_number ? ` · ${c.status.session_number}` : ''}
                        </span>
                      </td>
                      <td className="p-2 text-end font-mono">{c.status?.status === 'in_session' ? `${c.present} / ${c.members}` : `— / ${c.members}`}</td>
                      <td className="p-2 text-end font-mono">{c.speeches}</td>
                      <td className="p-2 text-end font-mono">{c.motions}</td>
                      <td className="p-2 text-end font-mono">{`${c.passed} / ${c.votes}`}</td>
                      <td className="p-2 text-end font-mono">{c.warnings}</td>
                      {grades !== null ? <td className="p-2 text-end font-mono">{c.grades ?? 0}</td> : null}
                      <td className="p-2">{lastText(c)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        )}
      </div>
      <PoweredBy locale={locale} />
    </main>
  );
}
