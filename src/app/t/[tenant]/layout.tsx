import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { tenantTranslator } from '@/config/store';
import { DEFAULT_LOCALE, translator } from '@/messages';
import { isSecureOrigin, rootDomain } from '@/platform/env';
import { resolveTenant, type TenantStatus } from '@/tenancy/directory';
import { parseTenantKey } from '@/tenancy/route';

type Props = { params: Promise<{ tenant: string }>; children: React.ReactNode };

export const dynamic = 'force-dynamic';

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
  const found = await lookup((await params).tenant);

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
  return children;
}
