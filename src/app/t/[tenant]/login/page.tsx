import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/ActionForm';
import { Field } from '@/components/Field';
import { BrandMark } from '@/components/BrandMark';
import { PoweredBy } from '@/components/PoweredBy';
import { assetUrl } from '@/data/storage';
import { initialsOf } from '@/site/presets';
import { siteOf } from '@/site/rules';
import { tenantTranslator } from '@/config/store';
import { localize, type MessageKey } from '@/messages';
import { SIGN_IN_PROBLEMS } from '@/auth/oauth-errors';
import { basePath, requireTenant, tenantContext } from '@/tenancy/context';
import { signInAction } from '../actions';
import { loadPublicSite } from '@/public/site';
import { mailConfigured } from '@/platform/mail';

export default async function LoginPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ error?: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const { t, locale, config } = await tenantTranslator(tenant.id);
  if (await tenantContext(tenant.id)) redirect(`${await basePath()}/`);

  const site = siteOf(config);
  const base = await basePath();
  const { error } = await searchParams;
  const providers = (['google', 'microsoft'] as const).filter((p) => config.people[`${p}SignIn`] === 'on');
  const logo = assetUrl(tenant.id, config.theme.logo);
  const tagline = localize(config.identity.tagline, locale);
  const follow = !!(await loadPublicSite(tenant.id, config).catch(() => null));
  return (
    <main id="main" className="flex flex-1 flex-col items-center justify-center p-4">
      <div className="card w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <BrandMark logo={logo} initials={site.header.mark === 'initials' ? site.header.initials || initialsOf(tenant.name) : null} size={52} />
          {/* The school can word its sign-in page itself (Settings → Branding). */}
          <h1 className="mt-2 text-xl font-bold text-on-surface">{localize(config.branding.loginTitle, locale) || t('auth.signIn.title', { name: tenant.name })}</h1>
          {localize(config.branding.loginMessage, locale) ? <p className="whitespace-pre-line text-sm">{localize(config.branding.loginMessage, locale)}</p> : tagline ? <p className="text-sm">{tagline}</p> : null}
        </div>
        <ActionForm action={signInAction.bind(null, key)} submitLabel={t('auth.signIn')}>
          <Field label={t('auth.email')} name="email" type="email" autoComplete="username" />
          <Field label={t('auth.password')} name="password" type="password" autoComplete="current-password" />
        </ActionForm>
        {error && (SIGN_IN_PROBLEMS as string[]).includes(error) ? (
          <p role="alert" className="error-text mt-3">
            {t(error === 'unavailable' ? 'auth.error.unavailable' : error === 'provider' ? 'auth.provider.failed' : (`auth.provider.${error}` as MessageKey))}
          </p>
        ) : null}
        {providers.length ? (
          <div className="mt-5 flex flex-col gap-2 border-t border-border pt-5">
            {providers.map((p) => (
              <a key={p} href={`${base}/auth/${p}`} className="btn btn-secondary w-full">
                {t(`auth.provider.${p}`)}
              </a>
            ))}
          </div>
        ) : null}
        {mailConfigured() ? (
          <p className="mt-3 text-center text-sm">
            <a className="underline underline-offset-2" href={`${base}/forgot`}>
              {t('forgot.link')}
            </a>
          </p>
        ) : null}
        <p className="mt-4 text-center text-xs">{t('auth.signIn.accounts')}</p>
      </div>
      {/* Delegates don't have accounts: when the school publishes its pages or live view, send them there. */}
      {follow ? (
        <a href={`${base}/public`} className="card mt-4 flex w-full max-w-sm items-center justify-between gap-3 hover:border-border-strong">
          <span>
            <span className="block font-semibold text-on-surface">{t('auth.follow.title')}</span>
            <span className="block text-sm">{t(config.publicSite.live === 'on' ? 'auth.follow.live' : 'auth.follow.pages')}</span>
          </span>
          <span aria-hidden="true" className="text-xl text-on-surface">
            →
          </span>
        </a>
      ) : null}
      <PoweredBy locale={locale} />
    </main>
  );
}
