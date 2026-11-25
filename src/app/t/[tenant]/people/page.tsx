import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { Field } from '@/components/Field';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { AdminTabs } from '@/site/AdminTabs';
import { tenantTranslator } from '@/config/store';
import { localize, type MessageKey } from '@/messages';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { addStarterRolesAction, inviteAction, memberRemoveAction, memberUpdateAction, newLinkAction, type InviteState } from './actions';
import { MemberControls } from './MemberControls';
import { loadPeople, type Person } from './data';
import { InviteForm, NewLinkForm } from './InviteForms';

const STATUS_KEY: Record<Person['status'], MessageKey> = {
  invited: 'people.status.invited',
  active: 'people.status.active',
  disabled: 'people.status.disabled',
};

export default async function PeoplePage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ status?: string; done?: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!ctx.can('users.view')) return <Notice title={t('forbidden.title')} body={t('forbidden.body')} locale={locale} />;

  const people = await loadPeople(tenant.id, ctx.token);
  const canManage = ctx.can('users.manage');
  // A brand-new school: the only role that exists is Owner, so nobody can be invited as anything else.
  const onlyOwnerRole = ctx.can('roles.manage') && people.roles.length === 1 && people.roles[0]?.key === 'owner';
  const { status: filter, done } = await searchParams;
  const shown = people.members.filter((m) => !filter || filter === 'all' || m.status === filter);
  const grantable = people.roles.map((r) => ({ key: r.key, label: localize(r.name, locale, r.key) }));
  const controlWords = { role: t('people.role'), changeRole: t('people.changeRole'), disable: t('people.disable'), enable: t('people.enable'), remove: t('people.remove'), removeConfirm: t('people.removeConfirm'), keep: t('people.keep'), failed: t('people.invite.error.failed') };
  const DONE: Record<string, MessageKey> = { role: 'people.done.role', disabled: 'people.done.disabled', active: 'people.done.active', removed: 'people.done.removed' };
  const resultLabels = { link: t('people.invite.link'), copy: t('people.invite.copy'), copied: t('people.invite.copied') };

  return (
    <Shell title={t('people.title')} size="full" locale={locale} help={{ href: `${base}/help#people`, label: t('help.thisPage') }}>
      <AdminTabs base={base} t={t} can={(x) => ctx.can(x)} current={'people'} />
      <div className="flex flex-col gap-6">
        {done && DONE[done] ? (
          <p role="status" className="card font-semibold text-on-surface">
            {t(DONE[done]!)}
          </p>
        ) : null}
        {onlyOwnerRole ? (
          <section className="card flex flex-col gap-4">
            <h2 className="text-lg font-bold text-on-surface">{t('people.roles.title')}</h2>
            <p>{t('people.roles.body')}</p>
            <ActionForm action={addStarterRolesAction.bind(null, key)} submitLabel={t('people.roles.add')} />
          </section>
        ) : null}

        {canManage ? (
          <section className="card">
            <h2 className="mb-4 text-lg font-bold text-on-surface">{t('people.invite.title')}</h2>
            <InviteForm action={inviteAction.bind(null, key)} submitLabel={t('people.invite.submit')} resultLabels={resultLabels}>
              <Field label={t('people.name')} name="full_name" autoComplete="off" required={false} />
              <Field label={t('people.email')} name="email" type="email" autoComplete="off" />
              <div>
                <label className="label" htmlFor="role">
                  {t('people.role')}
                </label>
                <select className="input" id="role" name="role" required defaultValue={people.roles.at(-1)?.key}>
                  {people.roles.map((r) => (
                    <option key={r.key} value={r.key}>
                      {localize(r.name, locale, r.key)}
                    </option>
                  ))}
                </select>
              </div>
            </InviteForm>
          </section>
        ) : null}

        <section className="card overflow-x-auto">
          <nav aria-label={t('people.filter')} className="mb-3 flex flex-wrap gap-1">
            {(['all', 'active', 'invited', 'disabled'] as const).map((f) => (
              <a key={f} href={`${base}/people${f === 'all' ? '' : `?status=${f}`}`} className="chip" aria-current={(filter ?? 'all') === f ? 'page' : undefined}>
                {t(`people.filter.${f}`)} ({f === 'all' ? people.members.length : people.members.filter((m) => m.status === f).length})
              </a>
            ))}
          </nav>
          <table className="w-full text-start text-sm">
            <thead>
              <tr className="border-b border-border">
                {(['people.name', 'people.email', 'people.role', 'people.status'] as const).map((k) => (
                  <th key={k} scope="col" className="label-text py-2 pe-4 text-start">
                    {t(k)}
                  </th>
                ))}
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => {
                const newLink: (state: InviteState, data: FormData) => Promise<InviteState> = newLinkAction.bind(null, key, m.userId);
                return (
                  <tr key={m.userId} className="border-b border-border align-top">
                    <td className="py-3 pe-4 font-semibold text-on-surface">{m.fullName || '—'}</td>
                    <td className="py-3 pe-4">{m.email}</td>
                    <td className="py-3 pe-4">{localize(m.roleName, locale, m.roleKey)}</td>
                    <td className="py-3 pe-4">{t(STATUS_KEY[m.status])}</td>
                    <td className="flex flex-col gap-2 py-3">
                      {canManage && m.status === 'invited' ? <NewLinkForm action={newLink} label={t('people.invite.newLink')} resultLabels={resultLabels} /> : null}
                      {canManage && !m.me && people.myRank !== null && m.rank >= people.myRank ? (
                        <MemberControls
                          name={m.fullName || m.email}
                          role={m.roleKey}
                          status={m.status}
                          roles={grantable.some((r) => r.key === m.roleKey) ? grantable : [{ key: m.roleKey, label: localize(m.roleName, locale, m.roleKey) }, ...grantable]}
                          update={memberUpdateAction.bind(null, key, m.userId)}
                          remove={memberRemoveAction.bind(null, key, m.userId)}
                          L={controlWords}
                        />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

      </div>
    </Shell>
  );
}
