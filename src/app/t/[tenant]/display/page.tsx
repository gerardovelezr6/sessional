import { cookies } from 'next/headers';
import { tenantConfig } from '@/config/store';
import { assetUrl } from '@/data/storage';
import { catalogs, type MessageKey } from '@/messages';
import { screenCookie, screenTranslator, screenView } from '@/live/screen';
import { buildTheme, renderTheme } from '@/theme/engine';
import type { ThemeChoice } from '@/theme/presets';
import { basePath, requireTenant } from '@/tenancy/context';
import { Screen } from './Screen';

// A projection screen: open this address on the computer connected to the projector. No sign-in.

export const dynamic = 'force-dynamic';

const words = (t: (k: MessageKey) => string) =>
  Object.fromEntries(
    Object.keys(catalogs.en)
      .filter((k) => k.startsWith('screen.'))
      .map((k) => [k.slice(7), t(k as MessageKey)]),
  );

export default async function DisplayPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: key } = await params;
  const tenant = await requireTenant(key);
  const config = await tenantConfig(tenant.id);
  const view = await screenView(tenant.id, config, (await cookies()).get(screenCookie(tenant.id))?.value).catch(() => null);
  const base = await basePath();
  // The school's colours for the screen: dark unless the school chose light.
  const stage = renderTheme(buildTheme({ ...(config.theme as unknown as ThemeChoice), colorMode: config.theme.screenStyle === 'light' ? 'light' : 'dark' }), '.screen');
  const school = screenTranslator(config, config.locale.defaultLocale);
  const committee = view?.paired ? screenTranslator(config, view.locale) : null;
  return (
    <>
      <style href={`screen-${tenant.id}`} precedence="theme">
        {stage}
      </style>
      <Screen
        initial={view}
        stateUrl={`${base}/display/state`}
        schoolName={tenant.name}
        logoUrl={assetUrl(tenant.id, config.theme.logo)}
        L={words(school)}
        Lpaired={committee ? words(committee) : null}
      />
    </>
  );
}
