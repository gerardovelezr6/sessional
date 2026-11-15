import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { Field } from '@/components/Field';
import { BrandMark } from '@/components/BrandMark';
import { PoweredBy } from '@/components/PoweredBy';
import { assetUrl } from '@/data/storage';
import { initialsOf } from '@/site/presets';
import { siteOf } from '@/site/rules';
import { tenantTranslator } from '@/config/store';
import { localize } from '@/messages';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { signInAction } from '../actions';

export default async function LoginPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale, config } = await tenantTranslator(tenant.id);
  if (await tenantContext(tenant.id)) redirect(`${await basePath()}/`);

  const site = siteOf(config);
  const logo = assetUrl(tenant.id, config.theme.logo);
  const tagline = localize(config.identity.tagline, locale);
  return (
    <main className="flex flex-1 flex-col items-center justify-center p-4">
      <div className="card w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <BrandMark logo={logo} initials={site.header.mark === 'initials' ? site.header.initials || initialsOf(tenant.name) : null} size={52} />
          <h1 className="mt-2 text-xl font-bold text-on-surface">{t('auth.signIn.title', { name: tenant.name })}</h1>
          {tagline ? <p className="text-sm">{tagline}</p> : null}
        </div>
        <ActionForm action={signInAction.bind(null, key)} submitLabel={t('auth.signIn')}>
          <Field label={t('auth.email')} name="email" type="email" autoComplete="username" />
          <Field label={t('auth.password')} name="password" type="password" autoComplete="current-password" />
        </ActionForm>
        <p className="mt-4 text-center text-xs">{t('auth.signIn.accounts')}</p>
      </div>
      <PoweredBy locale={locale} />
    </main>
  );
}
