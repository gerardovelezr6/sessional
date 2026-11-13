import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { tenantTranslator } from '@/config/store';
import { localize } from '@/messages';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';

export default async function TenantHome({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale } = await tenantTranslator(tenant.id);
  const base = await basePath();
  const ctx = await tenantContext(tenant.id);
  if (!ctx) redirect(`${base}/login`);

  if (!ctx.membership) {
    return (
      <Shell title={t('noAccess.title')} locale={locale}>
        <div className="card">
          <p>{t('noAccess.body', { email: ctx.user.email })}</p>
        </div>
      </Shell>
    );
  }

  const places = [
    ...(ctx.can('users.view') ? [{ href: `${base}/people`, title: t('nav.people'), help: t('home.people.help') }] : []),
    ...(ctx.can('tenant.manage') ? [{ href: `${base}/settings`, title: t('nav.settings'), help: t('home.settings.help') }] : []),
  ];

  return (
    <Shell title={tenant.name} size="wide" locale={locale}>
      <div className="flex flex-col gap-6">
        <div className="card flex flex-col gap-1">
          <p className="text-lg font-bold text-on-surface">{t('home.welcome', { name: ctx.user.fullName || ctx.user.email })}</p>
          <p>{t('home.role', { role: localize(ctx.membership.roleName, locale, ctx.membership.roleKey) })}</p>
          <p className="text-sm">{t('tenant.ready')}</p>
        </div>
        {places.length ? (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {places.map((p) => (
              <li key={p.href}>
                <Link href={p.href} className="card flex h-full flex-col gap-1 hover:border-border-strong">
                  <span className="text-lg font-bold text-on-surface">{p.title}</span>
                  <span className="text-sm">{p.help}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Shell>
  );
}
