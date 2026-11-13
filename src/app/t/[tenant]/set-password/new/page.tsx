import { ActionForm } from '@/components/ActionForm';
import { Field } from '@/components/Field';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { tenantTranslator } from '@/config/store';
import { requireTenant, tenantContext } from '@/tenancy/context';
import { savePasswordAction } from '../actions';

export default async function NewPasswordPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale, config } = await tenantTranslator(tenant.id);
  if (!(await tenantContext(tenant.id))) {
    return <Notice title={t('setPassword.invalid.title')} body={t('setPassword.error.session')} locale={locale} />;
  }
  return (
    <Shell centered title={t('setPassword.title')} locale={locale}>
      <div className="card">
        <ActionForm action={savePasswordAction.bind(null, key)} submitLabel={t('setPassword.save')}>
          <Field label={t('setPassword.new')} name="password" type="password" autoComplete="new-password" minLength={config.people.passwordMinLength} hint={t('setPassword.hint', { min: config.people.passwordMinLength })} />
          <Field label={t('setPassword.repeat')} name="repeat" type="password" autoComplete="new-password" />
        </ActionForm>
      </div>
    </Shell>
  );
}
