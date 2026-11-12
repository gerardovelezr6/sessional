import { ActionForm, type FormState } from '@/components/ActionForm';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { tenantTranslator } from '@/config/store';
import { requireTenant } from '@/tenancy/context';
import { confirmLinkAction } from './actions';

// Landing page of an invitation or reset link. It only shows a button: nothing is used up until
// the person presses it.
export default async function SetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale } = await tenantTranslator(tenant.id);
  const { token_hash: tokenHash, type } = await searchParams;
  if (!tokenHash || !/^[A-Za-z0-9_-]{16,256}$/.test(tokenHash)) {
    return <Notice title={t('setPassword.invalid.title')} body={t('setPassword.invalid.body')} locale={locale} />;
  }
  const confirm: (state: FormState, data: FormData) => Promise<FormState> = confirmLinkAction.bind(null, key, tokenHash, type === 'recovery' ? 'recovery' : 'invite');

  return (
    <Shell title={t('setPassword.confirm.title')} locale={locale}>
      <div className="card flex flex-col gap-4">
        <p>{t('setPassword.confirm.body')}</p>
        <ActionForm action={confirm} submitLabel={t('setPassword.confirm.button')} />
      </div>
    </Shell>
  );
}
