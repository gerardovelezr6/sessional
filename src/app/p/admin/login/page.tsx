import { notFound, redirect } from 'next/navigation';
import { accessToken } from '@/auth/session';
import { ActionForm } from '@/components/ActionForm';
import { Field } from '@/components/Field';
import { Shell } from '@/components/Shell';
import { DEFAULT_LOCALE, translator } from '@/messages';
import { isPlatformAdmin } from '@/platform/admin';
import { basePath } from '@/tenancy/context';
import { adminSignInAction } from '../actions';

// The one page of the admin host anyone may see. A signed-in admin goes on; anyone else signed in
// here is not an admin (sign-in keeps no one else) and gets "not found".
export default async function AdminLoginPage() {
  const t = translator(DEFAULT_LOCALE);
  const token = await accessToken();
  if (token) {
    if (await isPlatformAdmin(token)) redirect(`${await basePath()}/`);
    notFound();
  }
  return (
    <Shell centered title={t('platform.signIn.title')}>
      <div className="card">
        <ActionForm action={adminSignInAction} submitLabel={t('auth.signIn')}>
          <Field label={t('auth.email')} name="email" type="email" autoComplete="username" />
          <Field label={t('auth.password')} name="password" type="password" autoComplete="current-password" />
        </ActionForm>
      </div>
    </Shell>
  );
}
