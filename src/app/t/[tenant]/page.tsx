import { notFound } from 'next/navigation';
import { PoweredBy } from '@/components/PoweredBy';
import { DEFAULT_LOCALE, translator } from '@/messages';
import { resolveTenant } from '@/tenancy/directory';
import { parseTenantKey } from '@/tenancy/route';

export default async function TenantHome({ params }: { params: Promise<{ tenant: string }> }) {
  const t = translator(DEFAULT_LOCALE);
  const address = parseTenantKey((await params).tenant);
  const found = address ? await resolveTenant(address) : null;
  if (found?.kind !== 'tenant') notFound();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-12 text-center">
      <h1 className="text-3xl font-bold text-on-surface">{found.tenant.name}</h1>
      <p className="max-w-md text-on-surface-muted">{t('tenant.ready')}</p>
      <PoweredBy />
    </main>
  );
}
