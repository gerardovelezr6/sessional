import { redirect } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { enabledLocales, tenantTranslator } from '@/config/store';
import { rpc } from '@/data/rpc';
import { directionOf, languageName } from '@/i18n/locales';
import { catalogs, type MessageKey } from '@/messages';
import { PERMISSIONS } from '@/people/permissions';
import { OwnerNav } from '@/site/OwnerNav';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { deleteRoleAction, saveRolesAction } from './actions';
import { RolesEditor, type RoleView } from './RolesEditor';

// Roles and permissions, as a matrix. Everyone who manages people can read it; changing it needs
// roles.manage, and then only below one's own rank.
export default async function RolesPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ done?: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale, config } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);
  if (!ctx.can('roles.manage') && !ctx.can('users.view')) return <Notice title={t('forbidden.title')} body={t('forbidden.body')} locale={locale} />;

  const matrix = await rpc<{ my_rank: number; roles: RoleView[] } | null>('roles_matrix', { p_tenant: tenant.id }, { token: ctx.token });
  const L = Object.fromEntries(
    Object.keys(catalogs.en)
      .filter((k) => k.startsWith('roles.ui.'))
      .map((k) => [k.slice('roles.ui.'.length), t(k as MessageKey)]),
  );
  const labels = Object.fromEntries(PERMISSIONS.map((p) => [p.key, { name: t(`permission.${p.key}` as MessageKey), help: t(`permission.${p.key}.help` as MessageKey) }]));
  // Only permissions held outright can be given; the database checks the same.
  const mine = PERMISSIONS.map((p) => p.key).filter((p) => ctx.can(p));
  const { done } = await searchParams;

  return (
    <Shell title={t('roles.title')} size="full" locale={locale}>
      <OwnerNav base={base} t={t} can={(x) => ctx.can(x)} current={'roles'}>
      <div className="flex flex-col gap-4">
        {done === 'saved' || done === 'deleted' ? (
          <p role="status" className="card font-semibold text-on-surface">
            {t(done === 'saved' ? 'roles.saved' : 'roles.deleted')}
          </p>
        ) : null}
        <p className="text-sm">{t('roles.help')}</p>
        <div className="card">
          {matrix && ctx.can('roles.manage') ? (
            <RolesEditor
              roles={matrix.roles}
              myRank={matrix.my_rank}
              mine={mine}
              locales={enabledLocales(config).map((l) => ({ code: l, label: languageName(l, locale), dir: directionOf(l) }))}
              locale={locale}
              labels={labels}
              L={L}
              save={saveRolesAction.bind(null, key)}
              remove={deleteRoleAction.bind(null, key)}
            />
          ) : (
            <ReadOnly roles={matrix?.roles ?? []} labels={labels} locale={locale} caption={t('roles.ui.matrix')} permissionWord={t('roles.ui.permission')} />
          )}
        </div>
      </div>
      </OwnerNav>
    </Shell>
  );
}

function ReadOnly({ roles, labels, locale, caption, permissionWord }: { roles: RoleView[]; labels: Record<string, { name: string }>; locale: string; caption: string; permissionWord: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border-strong">
            <th scope="col" className="label-text p-2 text-start">{permissionWord}</th>
            {roles.map((r) => (
              <th key={r.key} scope="col" className="p-2 text-center">{r.name[locale] ?? Object.values(r.name)[0] ?? r.key}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERMISSIONS.map((p) => (
            <tr key={p.key} className="border-b border-border">
              <th scope="row" className="p-2 text-start font-semibold text-on-surface">{labels[p.key]?.name}</th>
              {roles.map((r) => (
                <td key={r.key} className="p-2 text-center">{r.all_permissions || r.permissions.includes(p.key) ? '✓' : ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
