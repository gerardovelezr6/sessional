import type { Metadata, Viewport } from 'next';
import { cookies, headers } from 'next/headers';
import { notFound, permanentRedirect, redirect } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { AccountMenu } from '@/components/AccountMenu';
import { CookieNotice } from '@/components/CookieNotice';
import { BillingBanner } from '@/site/BillingBanner';
import { PlatformBanners } from '@/site/PlatformBanners';
import { requestTime } from '@/platform/health';
import { NavLinks } from '@/components/NavLinks';
import { localize } from '@/messages';
import { enabledLocales, tenantConfig, tenantTranslator } from '@/config/store';
import { languageName } from '@/i18n/locales';
import { DEFAULT_LOCALE, translator } from '@/messages';
import { isSecureOrigin, rootDomain } from '@/platform/env';
import { resolveTenant, type TenantStatus } from '@/tenancy/directory';
import { basePath, tenantContext } from '@/tenancy/context';
import { BASE_PATH_HEADER, parseTenantKey, SAFE_MODE_HEADER, TENANT_PATH_HEADER } from '@/tenancy/route';
import { AccessGate } from '@/access/AccessGate';
import { ACCESS_CODE_COOKIE, passValid } from '@/access/code';
import { sanitizeCustomCss } from '@/theme/custom-css';
import { assetUrl } from '@/data/storage';
import { buildTheme, themeCss } from '@/theme/engine';
import type { ThemeChoice } from '@/theme/presets';
import { setLanguageAction, signOutAction } from './actions';
import { setPreviewAction, type SettingsState } from './settings/actions';
import { ActionButton } from './settings/SectionForm';
import { BrandMark } from '@/components/BrandMark';
import { initialsOf } from '@/site/presets';
import { siteOf } from '@/site/rules';
import { navLinks } from '@/site/nav';

type Props = { params: Promise<{ tenant: string }>; children: React.ReactNode };

export const dynamic = 'force-dynamic';

// Short stable name for a stylesheet, so identical themes are emitted once.
function hashOf(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const isHidden = (status: TenantStatus) => status === 'suspended' || status === 'deleted';

async function lookup(key: string) {
  const address = parseTenantKey(key);
  return address ? resolveTenant(address) : ({ kind: 'none' } as const);
}

// The browser's bar takes the school's page color.
export async function generateViewport({ params }: Props): Promise<Viewport> {
  const found = await lookup((await params).tenant);
  if (found.kind !== 'tenant' || isHidden(found.tenant.status)) return {};
  const { config } = await tenantTranslator(found.tenant.id);
  const theme = buildTheme(config.theme as unknown as ThemeChoice);
  const light = theme.light['--s-color-surface'];
  const dark = theme.dark['--s-color-surface'];
  if (config.theme.colorMode === 'dark') return dark ? { themeColor: dark } : {};
  if (config.theme.colorMode === 'light') return light ? { themeColor: light } : {};
  return { themeColor: [...(light ? [{ media: '(prefers-color-scheme: light)', color: light }] : []), ...(dark ? [{ media: '(prefers-color-scheme: dark)', color: dark }] : [])] };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = await lookup((await params).tenant);
  // A suspended or deleted tenant reveals nothing, not even its name.
  if (found.kind !== 'tenant' || isHidden(found.tenant.status)) return { robots: { index: false, follow: false } };
  const { config } = await tenantTranslator(found.tenant.id);
  const icon = assetUrl(found.tenant.id, config.theme.favicon);
  return {
    title: found.tenant.name,
    robots: { index: false, follow: false },
    ...(icon ? { icons: { icon, apple: icon } } : {}),
  };
}

// Every tenant page passes through here: the tenant is resolved and checked on the server before
// anything renders.
export default async function TenantLayout({ params, children }: Props) {
  const t = translator(DEFAULT_LOCALE);
  const key = (await params).tenant;
  const found = await lookup(key);

  if (found.kind === 'none') notFound();
  if (found.kind === 'renamed') {
    permanentRedirect(`${isSecureOrigin() ? 'https' : 'http'}://${found.slug}.${rootDomain()}/`);
  }
  if (found.kind === 'unconfigured') {
    return <Notice title={t('tenant.unconfigured.title')} body={t('tenant.unconfigured.body')} />;
  }
  if (found.kind === 'error') {
    return <Notice title={t('tenant.error.title')} body={t('tenant.error.body')} />;
  }
  if (isHidden(found.tenant.status)) {
    const own = await tenantTranslator(found.tenant.id);
    return <Notice title={own.t('tenant.unavailable.title')} body={own.t('tenant.unavailable.body')} locale={own.locale} />;
  }
  // A school with its own primary domain is served there: its other addresses send people on.
  if (found.tenant.primary) {
    const h = await headers();
    const here = (h.get('host') ?? '').split(':')[0];
    if (here && here !== found.tenant.primary && !h.get(BASE_PATH_HEADER)) {
      redirect(`${isSecureOrigin() ? 'https' : 'http'}://${found.tenant.primary}${h.get(TENANT_PATH_HEADER) ?? '/'}`);
    }
  }
  // An editor previewing their drafts always sees that they are: the banner cannot be dismissed
  // while preview is on.
  const own = await tenantTranslator(found.tenant.id);
  // The school's design, as CSS variables. React places this in <head> with the first HTML, so the
  // product's default colours never flash.
  const css = themeCss(own.config.theme);
  // Custom CSS: only the sanitised result, and never in safe mode.
  const safeMode = (await headers()).get(SAFE_MODE_HEADER) === '1';
  const custom = !safeMode && own.config.theme.customCss ? sanitizeCustomCss(own.config.theme.customCss, buildTheme(own.config.theme)).css : '';
  const theme = (
    <>
      <style href={`theme-${hashOf(css)}`} precedence="theme">
        {css}
      </style>
      {custom ? (
        <style href={`custom-${hashOf(custom)}`} precedence="theme">
          {custom}
        </style>
      ) : null}
      {safeMode ? (
        <p role="status" className="bg-accent px-4 py-2 text-center text-sm font-semibold text-on-accent">
          {own.t('safeMode.banner')}
        </p>
      ) : null}
    </>
  );
  const logo = assetUrl(found.tenant.id, own.config.theme.logo);
  const languages = enabledLocales(own.config);
  const base = await basePath();
  const ctx = await tenantContext(found.tenant.id).catch(() => null);
  // The menu, as the school arranged it: only the places this person can use.
  const site = siteOf(own.config);
  const links = ctx?.membership ? navLinks(site, base, (p) => ctx.can(p), own.locale, own.t) : [];
  const tagline = site.header.tagline ? localize(own.config.identity.tagline, own.locale) : '';
  const initials = site.header.mark === 'initials' ? site.header.initials || initialsOf(found.tenant.name) : null;
  const header = (
    <header className="app-header sticky top-0 z-20 flex-wrap">
      <a href="#main" className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:start-4 focus-visible:top-2 focus-visible:z-30 focus-visible:bg-surface-raised focus-visible:px-4 focus-visible:py-2 focus-visible:text-on-surface">
        {own.t('landing.skip')}
      </a>
      <a href={`${base}/`} className="app-identity">
        <BrandMark logo={logo} initials={initials} />
        <span className="min-w-0">
          <span className="app-identity-name">{found.tenant.name}</span>
          {tagline ? <span className="app-identity-tagline">{tagline}</span> : null}
        </span>
      </a>
      <div className="ms-auto flex flex-wrap items-center gap-2">
        {links.length ? <NavLinks label={own.t('nav.main')} links={links} /> : null}
        {ctx && site.header.userName ? <span className="hidden text-xs font-normal opacity-75 sm:inline">{ctx.user.fullName || ctx.user.email}</span> : null}
        {ctx || languages.length > 1 ? (
          <AccountMenu
            label={own.t(ctx ? 'account.menu' : 'account.language')}
            initials={ctx ? initialsOf(ctx.user.fullName || ctx.user.email) : null}
            title={ctx ? ctx.user.fullName || ctx.user.email : undefined}
            subtitle={ctx?.user.fullName ? ctx.user.email : undefined}
          >
            {languages.length > 1 ? (
              <div className="flex items-center justify-between gap-3">
                <span>{own.t('language.label')}</span>
                <LanguageSwitch
                  action={setLanguageAction.bind(null, key)}
                  current={own.locale}
                  // Each language is named in itself, so people can find their own.
                  options={languages.map((l) => ({ value: l, label: languageName(l, l), lang: l }))}
                  labels={{ language: own.t('language.label'), change: own.t('language.change') }}
                />
              </div>
            ) : null}
            {ctx?.membership ? (
              <a className="font-semibold text-on-surface underline-offset-2 hover:underline" href={`${base}/help`}>
                {own.t('help.link')}
              </a>
            ) : null}
            {ctx ? <ActionButton small action={signOutAction.bind(null, key) as unknown as (state: SettingsState, data: FormData) => Promise<SettingsState>} label={own.t('auth.signOut')} /> : null}
          </AccountMenu>
        ) : null}
      </div>
    </header>
  );
  // The conference access code: everything waits behind it, except invitation links and
  // projection screens. Signed-in members pass unless the school asks them too.
  const gate = (await tenantConfig(found.tenant.id)).access.gate;
  if (gate) {
    const h = await headers();
    const path = h.get(TENANT_PATH_HEADER) ?? '/';
    const exempt = /^\/(set-password|display|privacy|terms|forgot)(\/|$)/.test(path);
    const passed = passValid((await cookies()).get(ACCESS_CODE_COOKIE)?.value, found.tenant.id, gate.codeHash);
    if (!exempt && !passed && !(ctx?.membership && !gate.members)) {
      return (
        <>
          {theme}
          <AccessGate
            tenantKey={key}
            name={found.tenant.name}
            logo={logo}
            initials={initials}
            hint={localize(gate.hint, own.locale)}
            next={`${base}${path}`}
            L={{ intro: own.t('gate.intro'), code: own.t('gate.code'), enter: own.t('gate.enter'), provided: own.t('gate.provided') }}
          />
        </>
      );
    }
  }
  const banners = (
    <>
      <PlatformBanners tenantId={found.tenant.id} base={base} locale={own.locale} t={own.t} manager={!!ctx?.can('tenant.manage')} name={ctx ? ctx.user.fullName || ctx.user.email : null} />
      <BillingBanner tenantId={found.tenant.id} status={found.tenant.status} token={ctx?.token ?? null} manager={!!ctx?.can('tenant.manage')} base={base} locale={own.locale} t={own.t} now={requestTime()} />
    </>
  );
  // The school's cookie note, when it turned it on (Settings → Consent).
  const cookies_ =
    own.config.consent.cookieNotice === 'on' ? (
      <CookieNotice
        text={localize(own.config.consent.cookieText, own.locale) || own.t('consent.cookie.default')}
        privacyHref={`${base}/privacy`}
        L={{ label: own.t('consent.cookie.label'), privacy: own.t('legal.privacy.title'), ok: own.t('consent.cookie.ok') }}
      />
    ) : null;
  if (!own.preview) {
    return (
      <>
        {theme}
        {banners}
        {header}
        {children}
        {cookies_}
      </>
    );
  }
  return (
    <>
      {theme}
      <div role="status" className="sticky top-0 z-10 flex flex-wrap items-center justify-center gap-4 bg-accent px-4 py-2 text-sm font-semibold text-on-accent">
        <span>{own.t('settings.preview.banner')}</span>
        <ActionButton action={setPreviewAction.bind(null, key, false) as (state: SettingsState, data: FormData) => Promise<SettingsState>} label={own.t('settings.preview.off')} />
      </div>
      {banners}
      {header}
      {children}
      {cookies_}
    </>
  );
}
