import { ActionForm } from '@/components/ActionForm';
import { Field } from '@/components/Field';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { DEFAULT_LOCALE, translator } from '@/messages';
import { PASSWORD_MIN_LENGTH } from '@/platform/defaults';
import { requireTenant, tenantContext } from '@/tenancy/context';
import { savePasswordAction } from '../actions';

export default async function NewPasswordPage({ params }: { params: Promise<{ tenant: string }> }) {
  const t = translator(DEFAULT_LOCALE);
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  if (!(await tenantContext(tenant.id))) {
    return <Notice title={t('setPassword.invalid.title')} body={t('setPassword.error.session')} />;
  }
  return (
    <Shell title={t('setPassword.title')}>
      <div className="card">
        <ActionForm action={savePasswordAction.bind(null, key)} submitLabel={t('setPassword.save')}>
          <Field label={t('setPassword.new')} name="password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} hint={t('setPassword.hint', { min: PASSWORD_MIN_LENGTH })} />
          <Field label={t('setPassword.repeat')} name="repeat" type="password" autoComplete="new-password" />
        </ActionForm>
      </div>
    </Shell>
  );
}
