import type { TenantConfig } from '@/config/schema';
import { standardSite } from './presets';
import type { Site } from './schema';

// The school's website settings; until it saves its own, the classic layout.
export const siteOf = (config: TenantConfig): Site => config.site.page ?? standardSite();
