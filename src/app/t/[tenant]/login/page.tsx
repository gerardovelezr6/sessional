import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { Field } from '@/components/Field';
import { Shell } from '@/components/Shell';
import { tenantTranslator } from '@/config/store';
import { localize } from '@/messages';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { signInAction } from '../actions';

export default async function LoginPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale, config } = await tenantTranslator(tenant.id);
  if (await tenantContext(tenant.id)) redirect(`${await basePath()}/`);

  return (
    <Shell title={t('auth.signIn.title', { name: tenant.name })} subtitle={localize(config.identity.tagline, locale) || undefined} locale={locale}>
      <div className="card">
        <ActionForm action={signInAction.bind(null, key)} submitLabel={t('auth.signIn')}>
          <Field label={t('auth.email')} name="email" type="email" autoComplete="username" />
          <Field label={t('auth.password')} name="password" type="password" autoComplete="current-password" />
        </ActionForm>
      </div>
    </Shell>
  );
}
