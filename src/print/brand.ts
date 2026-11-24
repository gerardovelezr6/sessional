import 'server-only';
import type { TenantConfig } from '@/config/schema';
import { assetUrl } from '@/data/storage';
import { buildTheme } from '@/theme/engine';
import type { ThemeChoice } from '@/theme/presets';
import type { Brand } from './pdf';

// The school's look for a printable: its theme colours and its logo, read from the file store.
export async function brandOf(tenant: { id: string; name: string }, config: TenantConfig): Promise<Brand> {
  const theme = buildTheme(config.theme as unknown as ThemeChoice).light;
  let logo: Uint8Array | null = null;
  const url = assetUrl(tenant.id, config.theme.logo);
  if (url) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000), cache: 'force-cache' });
      const bytes = res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
      logo = bytes && bytes.byteLength <= 2 * 1024 * 1024 ? bytes : null;
    } catch {
      logo = null;
    }
  }
  return { school: tenant.name, primary: theme['--s-color-primary']!, onPrimary: theme['--s-color-on-primary']!, logo, paper: config.printing.paper };
}
