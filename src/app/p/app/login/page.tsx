import { redirect } from 'next/navigation';
import { accessToken } from '@/auth/session';
import { ActionForm } from '@/components/ActionForm';
import { Field } from '@/components/Field';
import { Shell } from '@/components/Shell';
import { DEFAULT_LOCALE, translator } from '@/messages';
import { basePath } from '@/tenancy/context';
import { appSignInAction } from '../actions';

export default async function AppLoginPage() {
  const t = translator(DEFAULT_LOCALE);
  if (await accessToken()) redirect(`${await basePath()}/`);
  return (
    <Shell centered title={t('app.signIn.title')}>
      <div className="card">
        <ActionForm action={appSignInAction} submitLabel={t('auth.signIn')}>
          <Field label={t('auth.email')} name="email" type="email" autoComplete="username" />
          <Field label={t('auth.password')} name="password" type="password" autoComplete="current-password" />
        </ActionForm>
      </div>
    </Shell>
  );
}
