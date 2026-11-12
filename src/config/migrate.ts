import { CONFIG_SCHEMA_VERSION, type SectionName } from './schema';

// Stored configuration is upgraded in code, one schema version at a time, never by SQL that
// patches JSON. A migration is a pure function from the previous shape to the next one.
// migrations[n] upgrades data written with schema version n to version n + 1.

type Migration = Partial<Record<SectionName, (data: Record<string, unknown>) => Record<string, unknown>>>;

export const migrations: Record<number, Migration> = {
  // 1: { people: (d) => ({ ...d, renamedField: d.oldField }) },
};

export function upgrade(section: SectionName, data: Record<string, unknown>, fromVersion: number): Record<string, unknown> {
  let current = data;
  for (let v = fromVersion; v < CONFIG_SCHEMA_VERSION; v++) {
    const step = migrations[v]?.[section];
    if (step) current = step(current);
  }
  return current;
}
