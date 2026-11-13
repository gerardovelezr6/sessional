import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { tenantTranslator } from '@/config/store';
import { DEFAULT_LOCALE, translator } from '@/messages';
import { isSecureOrigin, rootDomain } from '@/platform/env';
import { resolveTenant, type TenantStatus } from '@/tenancy/directory';
import { parseTenantKey } from '@/tenancy/route';
import { themeCss } from '@/theme/engine';
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
  return {
    // A suspended or deleted tenant reveals nothing, not even its name.
    title: found.kind === 'tenant' && !isHidden(found.tenant.status) ? found.tenant.name : undefined,
    robots: { index: false, follow: false },
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
  const theme = (
    <style href={`theme-${hashOf(css)}`} precedence="theme">
      {css}
    </style>
  );
  if (!own.preview) {
    return (
      <>
        {theme}
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
      {children}
    </>
  );
}
