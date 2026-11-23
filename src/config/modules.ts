import type { TenantConfig } from './schema';

// Parts of the product a school can turn off (Owner → Settings → Modules). Off means hidden in
// every page and menu, and refused by the server.
export const MODULES = ['grading', 'documents', 'screens', 'discipline', 'announcements', 'schedule'] as const;
export type Module = (typeof MODULES)[number];

export const moduleOn = (config: Pick<TenantConfig, 'modules'>, m: Module) => config.modules[m] !== 'off';
