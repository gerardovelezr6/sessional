import type { MessageKey } from '@/messages';
import type { SectionName } from './schema';

// One entry per setting: how it is edited and described. The settings screens, CONFIG.md and the
// completeness tests are all driven from this list. A setting that exists in schema.ts but not
// here fails the tests.

export type Control =
  | { kind: 'number'; min: number; max: number }
  | { kind: 'select'; options: { value: string; labelKey: MessageKey }[] }
  | { kind: 'localizedText'; maxLength: number }
  | { kind: 'timeZone' };

export interface Setting {
  section: SectionName;
  key: string;
  labelKey: MessageKey;
  helpKey: MessageKey;
  // Who may change it.
  permission: string;
  control: Control;
}

export const SECTION_LABELS: Record<SectionName, MessageKey> = {
  identity: 'settings.identity',
  locale: 'settings.locale',
  people: 'settings.people',
};

export const registry: Setting[] = [
  {
    section: 'identity', key: 'tagline', permission: 'tenant.manage',
    labelKey: 'settings.identity.tagline', helpKey: 'settings.identity.tagline.help',
    control: { kind: 'localizedText', maxLength: 160 },
  },
  {
    section: 'identity', key: 'timeZone', permission: 'tenant.manage',
    labelKey: 'settings.identity.timeZone', helpKey: 'settings.identity.timeZone.help',
    control: { kind: 'timeZone' },
  },
  {
    section: 'locale', key: 'defaultLocale', permission: 'tenant.manage',
    labelKey: 'settings.locale.defaultLocale', helpKey: 'settings.locale.defaultLocale.help',
    control: {
      kind: 'select',
      options: [
        { value: 'en', labelKey: 'language.en' },
        { value: 'es', labelKey: 'language.es' },
      ],
    },
  },
  {
    section: 'people', key: 'passwordMinLength', permission: 'tenant.manage',
    labelKey: 'settings.people.passwordMinLength', helpKey: 'settings.people.passwordMinLength.help',
    control: { kind: 'number', min: 8, max: 128 },
  },
];
