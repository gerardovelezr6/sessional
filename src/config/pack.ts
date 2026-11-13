import { upgrade } from './migrate';
import { registry } from './registry';
import { validateSection } from './resolve';
import { CONFIG_SCHEMA_VERSION, type SectionData, type SectionName } from './schema';

// A pack is one settings section as a file, so a school can keep a copy, move a design or a set
// of rules to another school, or share it. Importing never makes anything live: it becomes a
// draft, checked exactly like a draft typed by hand.

export const PACK_FORMAT = 'sessional-pack';
export const PACK_VERSION = 1;
export const PACK_MAX_BYTES = 300_000;

export interface Pack {
  format: typeof PACK_FORMAT;
  version: typeof PACK_VERSION;
  kind: SectionName;
  schemaVersion: number;
  exportedAt: string;
  data: Record<string, unknown>;
}

// Files that belong to one school (its logo and icon) never travel in a pack.
const schoolOwned = (section: SectionName) => registry.filter((r) => r.section === section && r.control.kind === 'asset').map((r) => r.key);

export function exportPack<S extends SectionName>(section: S, data: SectionData<S>, now = new Date()): Pack {
  const copy: Record<string, unknown> = { ...data };
  for (const key of schoolOwned(section)) delete copy[key];
  return { format: PACK_FORMAT, version: PACK_VERSION, kind: section, schemaVersion: CONFIG_SCHEMA_VERSION, exportedAt: now.toISOString(), data: copy };
}

export type PackProblem = 'size' | 'format' | 'kind' | 'version' | 'invalid';
export type PackResult<S extends SectionName> = { ok: true; data: SectionData<S> } | { ok: false; problem: PackProblem; issues?: string[] };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// Reads a pack for `section`. `keep` supplies the school's own values for what packs never carry.
export function readPack<S extends SectionName>(text: string, section: S, keep: Partial<SectionData<S>> = {}): PackResult<S> {
  if (new TextEncoder().encode(text).length > PACK_MAX_BYTES) return { ok: false, problem: 'size' };
  let pack: unknown;
  try {
    pack = JSON.parse(text);
  } catch {
    return { ok: false, problem: 'format' };
  }
  if (!isObject(pack) || pack.format !== PACK_FORMAT || pack.version !== PACK_VERSION || !isObject(pack.data) || typeof pack.schemaVersion !== 'number') {
    return { ok: false, problem: 'format' };
  }
  if (pack.kind !== section) return { ok: false, problem: 'kind' };
  if (!Number.isInteger(pack.schemaVersion) || pack.schemaVersion < 1 || pack.schemaVersion > CONFIG_SCHEMA_VERSION) return { ok: false, problem: 'version' };

  const data = upgrade(section, pack.data, pack.schemaVersion);
  for (const key of schoolOwned(section)) delete data[key];
  const checked = validateSection(section, { ...data, ...keep });
  if (!checked.ok) return { ok: false, problem: 'invalid', issues: checked.issues.map((i) => i.path) };
  return { ok: true, data: checked.data };
}
