import { ActionForm, type FormState } from '@/components/ActionForm';
import { Notice } from '@/components/Notice';
import { Shell } from '@/components/Shell';
import { DEFAULT_LOCALE, translator } from '@/messages';
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
  const t = translator(DEFAULT_LOCALE);
  const { tenant: key } = await params;
  await requireTenant(key);
  const { token_hash: tokenHash, type } = await searchParams;
  if (!tokenHash || !/^[A-Za-z0-9_-]{16,256}$/.test(tokenHash)) {
    return <Notice title={t('setPassword.invalid.title')} body={t('setPassword.invalid.body')} />;
  }
  const confirm: (state: FormState, data: FormData) => Promise<FormState> = confirmLinkAction.bind(null, key, tokenHash, type === 'recovery' ? 'recovery' : 'invite');

  return (
    <Shell title={t('setPassword.confirm.title')}>
      <div className="card flex flex-col gap-4">
        <p>{t('setPassword.confirm.body')}</p>
        <ActionForm action={confirm} submitLabel={t('setPassword.confirm.button')} />
      </div>
    </Shell>
  );
}
