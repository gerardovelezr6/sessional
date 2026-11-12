import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { Shell } from '@/components/Shell';
import { tenantTranslator } from '@/config/store';
import { localize } from '@/messages';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { signOutAction } from './actions';

export default async function TenantHome({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);

  const signOut = <ActionForm action={signOutAction.bind(null, key)} submitLabel={t('auth.signOut')} variant="secondary" />;

  if (!ctx.membership) {
    return (
      <Shell title={t('noAccess.title')} locale={locale}>
        <div className="card flex flex-col gap-4">
          <p>{t('noAccess.body', { email: ctx.user.email })}</p>
          {signOut}
        </div>
      </Shell>
    );
  }

  return (
    <Shell title={tenant.name} locale={locale}>
      <div className="card flex flex-col gap-4">
        <p>{t('tenant.ready')}</p>
        <p>{t('home.signedInAs', { name: ctx.user.fullName || ctx.user.email })}</p>
        <p>{t('home.role', { role: localize(ctx.membership.roleName, locale, ctx.membership.roleKey) })}</p>
        {ctx.can('users.view') ? (
          <p>
            <Link className="btn btn-primary" href={`${base}/people`}>
              {t('home.people')}
            </Link>
          </p>
        ) : null}
        {signOut}
      </div>
    </Shell>
  );
}
