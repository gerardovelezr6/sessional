import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, permanentRedirect } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { LanguageSwitch } from '@/components/LanguageSwitch';
import { NavLinks } from '@/components/NavLinks';
import { localize } from '@/messages';
import { enabledLocales, tenantTranslator } from '@/config/store';
import { languageName } from '@/i18n/locales';
import { DEFAULT_LOCALE, translator } from '@/messages';
import { isSecureOrigin, rootDomain } from '@/platform/env';
import { resolveTenant, type TenantStatus } from '@/tenancy/directory';
import { basePath, tenantContext } from '@/tenancy/context';
import { parseTenantKey, SAFE_MODE_HEADER } from '@/tenancy/route';
import { sanitizeCustomCss } from '@/theme/custom-css';
import { assetUrl } from '@/data/storage';
import { buildTheme, themeCss } from '@/theme/engine';
import { setLanguageAction, signOutAction } from './actions';
import { setPreviewAction, type SettingsState } from './settings/actions';
import { ActionButton } from './settings/SectionForm';

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
  // Only the places this person can use.
  const links = ctx?.membership
    ? [
        { href: `${base}/`, label: own.t('nav.home'), exact: true },
        // Everyone sees committees on the home page; the list for managing them is for managers.
        ...(ctx.can('committee.manage') ? [{ href: `${base}/committees`, label: own.t('nav.committees') }] : []),
        ...(ctx.can('users.view') ? [{ href: `${base}/people`, label: own.t('nav.people') }] : []),
        ...(ctx.can('tenant.manage') ? [{ href: `${base}/settings`, label: own.t('nav.settings') }] : []),
      ]
    : [];
  const tagline = localize(own.config.identity.tagline, own.locale);
  const header = (
    <header className="app-header sticky top-0 z-20 flex-wrap">
      <a href={`${base}/`} className="app-identity">
        {logo ? (
          // The name is written beside it, so the image needs no text of its own.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" />
        ) : null}
        <span className="min-w-0">
          <span className="app-identity-name">{found.tenant.name}</span>
          {tagline ? <span className="app-identity-tagline">{tagline}</span> : null}
        </span>
      </a>
      <div className="ms-auto flex flex-wrap items-center gap-2">
        {links.length > 1 ? <NavLinks label={own.t('nav.main')} links={links} /> : null}
        {languages.length > 1 ? (
          <LanguageSwitch
            action={setLanguageAction.bind(null, key)}
            current={own.locale}
            // Each language is named in itself, so people can find their own.
            options={languages.map((l) => ({ value: l, label: languageName(l, l), lang: l }))}
            labels={{ language: own.t('language.label'), change: own.t('language.change') }}
          />
        ) : null}
        {ctx ? (
          <div className="flex items-center gap-2 text-sm font-normal">
            <span className="hidden sm:inline">{ctx.user.fullName || ctx.user.email}</span>
            <ActionButton action={signOutAction.bind(null, key) as unknown as (state: SettingsState, data: FormData) => Promise<SettingsState>} label={own.t('auth.signOut')} />
          </div>
        ) : null}
      </div>
    </header>
  );
  if (!own.preview) {
    return (
      <>
        {theme}
        {header}
        {children}
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
      {header}
      {children}
    </>
  );
}
