import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { Field } from '@/components/Field';
import { Shell } from '@/components/Shell';
import { tenantTranslator } from '@/config/store';
import { mailConfigured } from '@/platform/mail';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { forgotAction } from './actions';

// "Forgot your password?": asks for the email address and sends a one-time link from the school.
export default async function ForgotPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ sent?: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale } = await tenantTranslator(tenant.id);
  const base = await basePath();
  if (await tenantContext(tenant.id)) redirect(`${base}/`);
  const { sent } = await searchParams;
  return (
    <Shell title={t('forgot.title')} subtitle={t('forgot.subtitle', { name: tenant.name })} centered locale={locale}>
      <div className="card flex flex-col gap-4">
        {!mailConfigured() ? (
          <p>{t('forgot.unavailable')}</p>
        ) : sent ? (
          <p role="status" className="font-semibold text-on-surface">
            {t('forgot.sent')}
          </p>
        ) : (
          <ActionForm action={forgotAction.bind(null, key)} submitLabel={t('forgot.submit')}>
            <Field label={t('auth.email')} name="email" type="email" autoComplete="username" />
          </ActionForm>
        )}
        <a className="text-sm underline underline-offset-2" href={`${base}/login`}>
          {t('forgot.back')}
        </a>
      </div>
    </Shell>
  );
}
