import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { ConfirmButton } from '@/components/ConfirmButton';
import { AdminShell } from '@/app/p/admin/AdminShell';
import { rpc } from '@/data/rpc';
import { DEFAULT_LOCALE, translator, type MessageKey } from '@/messages';
import { requireAdmin } from '@/platform/admin';
import { isSecureOrigin, rootDomain } from '@/platform/env';
import { FLAGS } from '@/platform/flags';
import { healthOf, isPast, LEVEL_TONE, type Usage } from '@/platform/health';
import { basePath } from '@/tenancy/context';
import { assignReferralAction, deleteAction, flagOverrideAction, impersonateAction, organisationAction, purgeAction, restoreAction, suspendAction, tenantBillingAction } from '../../actions';

// Admin → a school: status, usage and health, its members (and signing in as one of them, for a
// stated reason and a limited time), flags, recent activity and the diagnostic bundle.

interface Detail {
  id: string;
  slug: string;
  name: string;
  status: string;
  status_before: string | null;
  plan_key: string | null;
  created_at: string;
  deleted_at: string | null;
  purge_after: string | null;
  usage: Usage;
  domains: { host: string; verified: boolean }[];
  members: { user_id: string; email: string; name: string; role_key: string; status: string; staff: boolean }[];
  flags: Record<string, boolean>;
  impersonations: { id: string; admin: string; target: string; reason: string; started_at: string; expires_at: string; ended_at: string | null; ended_why: string | null }[];
  audit: { action: string; created_at: string; by_platform: boolean }[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DONE: Record<string, MessageKey> = {
  billing: 'platform.done.billing', referral: 'platform.done.billing', suspended: 'platform.done.suspended', unsuspended: 'platform.done.unsuspended', deleted: 'platform.done.deleted', restored: 'platform.done.restored', flag: 'platform.done.flag',
};

export default async function AdminSchool({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string }> }) {
  const t = translator(DEFAULT_LOCALE);
  const a = await requireAdmin();
  const base = await basePath();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const s = await rpc<Detail | null>('platform_tenant', { p_tenant: id }, a);
  if (!s) notFound();
  const { done } = await searchParams;
  const when = new Intl.DateTimeFormat(DEFAULT_LOCALE, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  const h = healthOf(s.usage, s.status);
  const open = s.status !== 'suspended' && s.status !== 'deleted';
  const address = `${isSecureOrigin() ? 'https' : 'http'}://${s.slug}.${rootDomain()}/`;
  const bill = await rpc<{ metered: boolean; plan: string | null; billing_status: string | null; overrides?: Record<string, number>; referral_code?: string | null } | null>('platform_tenant_billing', { p_tenant: s.id }, a).catch(() => null);
  const plans = await rpc<{ key: string; name: Record<string, string> }[]>('platform_plans', {}, a);
  const orgs = (await rpc<{ organisations: { id: string; name: string }[] }>('platform_billing_overview', {}, a)).organisations;

  return (
    <AdminShell title={s.name} intro={`${s.slug} · ${t(`platform.status.${s.status}` as MessageKey)}`}>
      <p className="-mt-3 text-sm">
        <a className="font-semibold underline underline-offset-2" href={`${base}/`}>
          {t('platform.backToSchools')}
        </a>
      </p>
      <div className="flex flex-col gap-6">
        {done && DONE[done] ? (
          <p role="status" className="card font-semibold text-on-surface">
            {t(DONE[done]!)}
          </p>
        ) : null}

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3" aria-label={t('platform.school.overview')}>
          <div className="card flex flex-col gap-2">
            <h2 className="text-lg font-bold text-on-surface">{t('platform.school.health')}</h2>
            <p>
              <span className={`badge ${LEVEL_TONE[h.level]}`}>{`${h.score} · ${t(`platform.health.${h.level}` as MessageKey)}`}</span>
            </p>
            {h.reasons.length ? (
              <ul className="list-inside list-disc text-sm">
                {h.reasons.map((r) => (
                  <li key={r}>{t(`platform.reason.${r}` as MessageKey)}</li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="card flex flex-col gap-1 text-sm lg:col-span-2">
            <h2 className="text-lg font-bold text-on-surface">{t('platform.school.usage')}</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
              {(['members', 'invited', 'conferences', 'committees', 'delegates', 'sessions_30d', 'changes_30d', 'settings_published', 'domains'] as const).map((k) => (
                <div key={k} className="flex justify-between gap-2 border-b border-border py-1">
                  <dt>{t(`platform.usage.${k}` as MessageKey)}</dt>
                  <dd className="font-mono">{s.usage[k]}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2">{t('platform.school.created', { date: when.format(new Date(s.created_at)) })}</p>
            <p>
              <a className="font-semibold underline underline-offset-2" href={address}>
                {address}
              </a>
              {' · '}
              <a className="font-semibold underline underline-offset-2" href={`${base}/tenants/${s.id}/diagnostics`} download>
                {t('platform.school.diagnostics')}
              </a>
            </p>
          </div>
        </section>

        <section className="card flex flex-col gap-3" aria-labelledby="members-title">
          <h2 id="members-title" className="text-lg font-bold text-on-surface">
            {t('platform.school.members')}
          </h2>
          <p className="text-sm">{t('platform.impersonate.help')}</p>
          <ul className="flex flex-col">
            {s.members.map((m) => (
              <li key={m.user_id} className="flex flex-col gap-2 border-b border-border py-2">
                <span>
                  <span className="font-semibold text-on-surface">{m.name || m.email}</span>
                  <span className="block text-xs">{`${m.email} · ${m.role_key} · ${t(`platform.member.${m.status === 'active' ? 'active' : 'invited'}` as MessageKey)}${m.staff ? ` · ${t('platform.member.staff')}` : ''}`}</span>
                </span>
                {open && m.status === 'active' ? (
                  <details>
                    <summary className="cursor-pointer text-sm font-semibold underline underline-offset-2">{t('platform.impersonate.open', { name: m.name || m.email })}</summary>
                    <div className="mt-2 max-w-xl">
                      <ActionForm action={impersonateAction.bind(null, s.id, s.slug)} submitLabel={t('platform.impersonate.submit')}>
                        <input type="hidden" name="user" value={m.user_id} />
                        <label className="flex flex-col gap-1">
                          <span className="label">{t('platform.impersonate.reason')}</span>
                          <textarea className="input" name="reason" required minLength={10} maxLength={500} rows={2} />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="label">{t('platform.impersonate.minutes')}</span>
                          <select className="input w-auto" name="minutes" defaultValue="30">
                            {[15, 30, 60].map((n) => (
                              <option key={n} value={n}>
                                {t('platform.impersonate.minutesN', { n })}
                              </option>
                            ))}
                          </select>
                        </label>
                      </ActionForm>
                    </div>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <section className="card flex flex-col gap-3" aria-labelledby="status-title">
          <h2 id="status-title" className="text-lg font-bold text-on-surface">
            {t('platform.school.status')}
          </h2>
          {s.status === 'deleted' ? (
            <>
              <p className="text-sm">{t('platform.school.deletedUntil', { date: s.purge_after ? when.format(new Date(s.purge_after)) : '—' })}</p>
              <div className="flex flex-wrap gap-2">
                <ActionForm action={restoreAction.bind(null, s.id)} submitLabel={t('platform.school.restore')} />
                {s.purge_after && isPast(s.purge_after) ? (
                  <ConfirmButton action={purgeAction.bind(null, s.id)} ask={t('platform.school.purge')} confirm={t('platform.school.purgeConfirm')} cancel={t('platform.school.keep')} />
                ) : null}
              </div>
            </>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ActionForm action={suspendAction.bind(null, s.id, s.status !== 'suspended')} submitLabel={t(s.status === 'suspended' ? 'platform.school.unsuspend' : 'platform.school.suspend')} variant="secondary">
                <p className="text-sm">{t(s.status === 'suspended' ? 'platform.school.unsuspendHelp' : 'platform.school.suspendHelp')}</p>
                <label className="flex flex-col gap-1">
                  <span className="label">{t('platform.school.reason')}</span>
                  <input className="input" name="reason" required minLength={5} maxLength={500} />
                </label>
              </ActionForm>
              <ActionForm action={deleteAction.bind(null, s.id)} submitLabel={t('platform.school.delete')} variant="secondary">
                <p className="text-sm">{t('platform.school.deleteHelp')}</p>
                <label className="flex flex-col gap-1">
                  <span className="label">{t('platform.school.confirmSlug', { slug: s.slug })}</span>
                  <input className="input" name="confirm" required autoComplete="off" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="label">{t('platform.school.reason')}</span>
                  <input className="input" name="reason" required minLength={5} maxLength={500} />
                </label>
              </ActionForm>
            </div>
          )}
        </section>

        <section className="card flex flex-col gap-3" aria-labelledby="billing-title">
          <h2 id="billing-title" className="text-lg font-bold text-on-surface">
            {t('platform.school.billing')}
          </h2>
          <p className="text-sm">
            {bill?.metered
              ? t('platform.school.billingLine', { plan: bill.plan ?? '—', status: bill.billing_status ?? '—' })
              : t('platform.school.unmetered')}
          </p>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ActionForm action={tenantBillingAction.bind(null, s.id)} submitLabel={t('platform.flags.save')} variant="secondary">
              <label className="flex flex-col gap-1">
                <span className="label">{t('platform.school.plan')}</span>
                <select className="input w-auto" name="plan" defaultValue={bill?.plan ?? 'conference'}>
                  {plans.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.name.en ?? p.key}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <legend className="label">{t('platform.school.overrides')}</legend>
                {(['committees', 'delegates', 'staff', 'active_conferences'] as const).map((k) => (
                  <label key={k} className="flex flex-col gap-1">
                    <span className="text-xs">{t(`platform.plans.limit.${k}` as MessageKey)}</span>
                    <input className="input" name={`override_${k}`} inputMode="numeric" defaultValue={bill?.overrides?.[k] ?? ''} />
                  </label>
                ))}
              </fieldset>
              <label className="flex flex-col gap-1">
                <span className="label">{t('platform.school.trialDays')}</span>
                <input className="input w-24" name="trial_days" type="number" min={0} max={365} />
              </label>
            </ActionForm>
            <ActionForm action={organisationAction.bind(null, s.id)} submitLabel={t('platform.school.attach')} variant="secondary">
              <p className="text-sm">{t('platform.school.organisationHelp')}</p>
              <label className="flex flex-col gap-1">
                <span className="label">{t('platform.school.organisation')}</span>
                <select className="input w-auto" name="organisation" defaultValue="">
                  <option value="">{t('platform.school.newOrganisation')}</option>
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="label">{t('platform.school.organisationName')}</span>
                <input className="input" name="name" maxLength={120} />
              </label>
            </ActionForm>
            <ActionForm action={assignReferralAction.bind(null, s.id)} submitLabel={t('platform.referrals.assign')} variant="secondary">
              <p className="text-sm">{t('platform.referrals.assignHelp')}</p>
              <label className="flex flex-col gap-1">
                <span className="label">{t('platform.referrals.referredBy')}</span>
                <input className="input w-48 font-mono uppercase" name="code" defaultValue={bill?.referral_code ?? ''} maxLength={30} autoComplete="off" spellCheck={false} />
              </label>
            </ActionForm>
          </div>
        </section>

        <section className="card flex flex-col gap-3" aria-labelledby="flags-title">
          <h2 id="flags-title" className="text-lg font-bold text-on-surface">
            {t('platform.school.flags')}
          </h2>
          <ul className="flex flex-col gap-2">
            {FLAGS.map((f) => {
              const own = s.flags[f.key];
              return (
                <li key={f.key} className="flex flex-wrap items-end gap-3 border-b border-border pb-2">
                  <span className="min-w-48 flex-1">
                    <span className="font-semibold text-on-surface">{t(f.label)}</span>
                    <span className="block text-xs">{own === undefined ? t('platform.flags.platformValue') : t(own ? 'platform.flags.forcedOn' : 'platform.flags.forcedOff')}</span>
                  </span>
                  <ActionForm action={flagOverrideAction.bind(null, s.id)} submitLabel={t('platform.flags.save')} variant="secondary">
                    <input type="hidden" name="key" value={f.key} />
                    <label className="flex flex-col gap-1">
                      <span className="label">{t('platform.flags.forThisSchool', { flag: t(f.label) })}</span>
                      <select className="input w-auto" name="value" defaultValue={own === undefined ? 'default' : own ? 'on' : 'off'}>
                        <option value="default">{t('platform.flags.asPlatform')}</option>
                        <option value="on">{t('settings.onOff.on')}</option>
                        <option value="off">{t('settings.onOff.off')}</option>
                      </select>
                    </label>
                  </ActionForm>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="card flex flex-col gap-2" aria-labelledby="imp-title">
          <h2 id="imp-title" className="text-lg font-bold text-on-surface">
            {t('platform.school.impersonations')}
          </h2>
          {s.impersonations.length === 0 ? <p className="text-sm">{t('platform.school.noImpersonations')}</p> : null}
          <ul className="flex flex-col text-sm">
            {s.impersonations.map((i) => (
              <li key={i.id} className="border-b border-border py-1">
                {t('platform.school.impersonationLine', { admin: i.admin, target: i.target, when: when.format(new Date(i.started_at)), reason: i.reason })}
                <span className="ms-2 badge">{i.ended_at ? t(`platform.ended.${i.ended_why ?? 'ended'}` as MessageKey) : !isPast(i.expires_at) ? t('platform.ended.active') : t('platform.ended.expired')}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card flex flex-col gap-2" aria-labelledby="audit-title">
          <h2 id="audit-title" className="text-lg font-bold text-on-surface">
            {t('platform.school.activity')}
          </h2>
          <ul className="flex flex-col font-mono text-xs">
            {s.audit.map((x, i) => (
              <li key={i} className="border-b border-border py-1">
                {`${when.format(new Date(x.created_at))} · ${x.action}${x.by_platform ? ` · ${t('platform.school.byPlatform')}` : ''}`}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AdminShell>
  );
}
