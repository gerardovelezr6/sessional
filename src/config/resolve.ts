import { upgrade } from './migrate';
import { CONFIG_SCHEMA_VERSION, sectionDefaults, sections, SECTION_NAMES, type SectionData, type SectionName, type TenantConfig } from './schema';

// Turns stored configuration into the typed configuration the app uses. Two modes:
//   validateSection  strict: used when someone saves; reports every problem
//   resolveSection   forgiving: used when rendering; a bad or missing value falls back to its
//                    default so a page can never break because of stored data

export interface Stored {
  data: unknown;
  schema_version: number;
}

export type Validation<S extends SectionName> =
  | { ok: true; data: SectionData<S> }
  | { ok: false; issues: { path: string; message: string }[] };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function validateSection<S extends SectionName>(section: S, data: unknown): Validation<S> {
  const result = sections[section].strict().safeParse(data);
  if (result.success) return { ok: true, data: result.data as SectionData<S> };
  return { ok: false, issues: result.error.issues.map((i) => ({ path: [section, ...i.path].join('.'), message: i.message })) };
}

export function resolveSection<S extends SectionName>(section: S, stored: Stored | null | undefined): { data: SectionData<S>; repaired: string[] } {
  const defaults = sectionDefaults(section);
  if (!stored || !isObject(stored.data) || stored.schema_version > CONFIG_SCHEMA_VERSION) {
    return { data: defaults, repaired: stored ? [section] : [] };
  }
  const upgraded = upgrade(section, stored.data, stored.schema_version);
  const whole = sections[section].safeParse(upgraded);
  if (whole.success) return { data: whole.data as SectionData<S>, repaired: [] };

  // Keep every field that is valid by itself; replace the rest with defaults.
  const shape = sections[section].shape as Record<string, { safeParse: (v: unknown) => { success: boolean; data?: unknown } }>;
  const data: Record<string, unknown> = { ...defaults };
  const repaired: string[] = [];
  for (const key of Object.keys(shape)) {
    if (!(key in upgraded)) continue;
    const field = shape[key]!.safeParse(upgraded[key]);
    if (field.success) data[key] = field.data;
    else repaired.push(`${section}.${key}`);
  }
  return { data: data as SectionData<S>, repaired };
}

export function resolveConfig(stored: Partial<Record<string, Stored>> | null | undefined): { config: TenantConfig; repaired: string[] } {
  const repaired: string[] = [];
  const config = Object.fromEntries(
    SECTION_NAMES.map((s) => {
      const r = resolveSection(s, stored?.[s]);
      repaired.push(...r.repaired);
      return [s, r.data];
    }),
  ) as TenantConfig;
  return { config, repaired };
}
