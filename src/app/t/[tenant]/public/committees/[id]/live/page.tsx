import { notFound } from 'next/navigation';
import { tenantConfig } from '@/config/store';
import { assetUrl } from '@/data/storage';
import { screenTranslator } from '@/live/screen';
import { catalogs, type MessageKey } from '@/messages';
import { publicLiveView } from '@/public/site';
import { basePath, requireTenant } from '@/tenancy/context';
import { buildTheme, renderTheme } from '@/theme/engine';
import type { ThemeChoice } from '@/theme/presets';
import { Screen } from '../../../../display/Screen';

// The delegate view: what the committee's projection screen shows, on any phone or laptop, with no
// sign-in. Read-only, and only when the school publishes it.

export const dynamic = 'force-dynamic';

const words = (t: (k: MessageKey) => string) =>
  Object.fromEntries(
    Object.keys(catalogs.en)
      .filter((k) => k.startsWith('screen.'))
      .map((k) => [k.slice(7), t(k as MessageKey)]),
  );

export default async function PublicLivePage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: key, id } = await params;
  const tenant = await requireTenant(key);
  const config = await tenantConfig(tenant.id);
  const view = await publicLiveView(tenant.id, config, id).catch(() => null);
  if (!view) notFound();
  const base = await basePath();
  const stage = renderTheme(buildTheme({ ...(config.theme as unknown as ThemeChoice), colorMode: config.theme.screenStyle === 'light' ? 'light' : 'dark' }), '.screen');
  const t = screenTranslator(config, view.locale);
  return (
    <>
      <style href={`screen-${tenant.id}`} precedence="theme">
        {stage}
      </style>
      <Screen initial={view} stateUrl={`${base}/public/committees/${id}/live/state`} schoolName={tenant.name} logoUrl={assetUrl(tenant.id, config.theme.logo)} L={words(t)} Lpaired={words(t)} />
    </>
  );
}
