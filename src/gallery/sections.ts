import { exportPack, type Pack } from '@/config/pack';
import { registry } from '@/config/registry';
import { defaultConfig, type SectionData, type SectionName } from '@/config/schema';
import type { MessageKey } from '@/messages';

// What can be shared in the community gallery, and what never travels with it. A school's own
// images (logo, icon) never leave it; nor do people's names (the signers on certificates). When a
// school installs a pack, it keeps its own values for those.

export const SHAREABLE = ['theme', 'terminology', 'structure', 'protocol', 'grading', 'printing'] as const satisfies readonly SectionName[];
export type ShareableSection = (typeof SHAREABLE)[number];
export const isShareable = (s: string): s is ShareableSection => (SHAREABLE as readonly string[]).includes(s);

const PRIVATE: Partial<Record<SectionName, string[]>> = {
  printing: ['signer1Name', 'signer1Role', 'signer2Name', 'signer2Role', 'signer3Name', 'signer3Role'],
};

// Keys the installing school keeps as they are: its images and its people.
export const keptOnInstall = (section: SectionName): string[] => [
  ...registry.filter((r) => r.section === section && r.control.kind === 'asset').map((r) => r.key),
  ...(PRIVATE[section] ?? []),
];

// The section as a pack for the gallery: without images or people.
export function galleryPack<S extends SectionName>(section: S, data: SectionData<S>): Pack {
  const pack = exportPack(section, data);
  for (const key of PRIVATE[section] ?? []) delete pack.data[key];
  return pack;
}

// What a pack changes from Sessional's defaults, as setting labels: shown to reviewers and to schools
// deciding whether to install it.
export function packSummary(section: SectionName, data: Record<string, unknown>): MessageKey[] {
  const defaults = defaultConfig()[section] as Record<string, unknown>;
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return registry.filter((r) => r.section === section && r.control.kind !== 'asset' && r.key in data && !same(data[r.key], defaults[r.key])).map((r) => r.labelKey);
}
