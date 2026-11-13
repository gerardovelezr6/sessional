import type { MessageKey } from '@/messages';
import type { SectionName } from './schema';

// One entry per setting: how it is edited and described. The settings screens, CONFIG.md and the
// completeness tests are all driven from this list. A setting that exists in schema.ts but not
// here fails the tests.

export type Control =
  | { kind: 'number'; min: number; max: number }
  // optional: the setting may be left empty, meaning "as the preset has it".
  | { kind: 'select'; options: { value: string; labelKey: MessageKey }[]; optional?: boolean }
  | { kind: 'color' }
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
  theme: 'settings.theme',
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
    section: 'theme', key: 'preset', permission: 'theme.edit',
    labelKey: 'settings.theme.preset', helpKey: 'settings.theme.preset.help',
    control: { kind: 'select', options: [{ value: 'sessional', labelKey: 'settings.theme.preset.sessional' }, { value: 'flat-institutional', labelKey: 'settings.theme.preset.flat-institutional' }, { value: 'classic-formal', labelKey: 'settings.theme.preset.classic-formal' }, { value: 'modern-rounded', labelKey: 'settings.theme.preset.modern-rounded' }, { value: 'high-contrast', labelKey: 'settings.theme.preset.high-contrast' }, { value: 'playful-school', labelKey: 'settings.theme.preset.playful-school' }] },
  },
  {
    section: 'theme', key: 'brand', permission: 'theme.edit',
    labelKey: 'settings.theme.brand', helpKey: 'settings.theme.brand.help',
    control: { kind: 'color' },
  },
  {
    section: 'theme', key: 'accent', permission: 'theme.edit',
    labelKey: 'settings.theme.accent', helpKey: 'settings.theme.accent.help',
    control: { kind: 'color' },
  },
  {
    section: 'theme', key: 'background', permission: 'theme.edit',
    labelKey: 'settings.theme.background', helpKey: 'settings.theme.background.help',
    control: { kind: 'color' },
  },
  {
    section: 'theme', key: 'font', permission: 'theme.edit',
    labelKey: 'settings.theme.font', helpKey: 'settings.theme.font.help',
    control: { kind: 'select', optional: true, options: [{ value: 'montserrat', labelKey: 'settings.theme.font.montserrat' }, { value: 'inter', labelKey: 'settings.theme.font.inter' }, { value: 'source-serif', labelKey: 'settings.theme.font.source-serif' }, { value: 'nunito', labelKey: 'settings.theme.font.nunito' }, { value: 'atkinson', labelKey: 'settings.theme.font.atkinson' }, { value: 'system', labelKey: 'settings.theme.font.system' }] },
  },
  {
    section: 'theme', key: 'radius', permission: 'theme.edit',
    labelKey: 'settings.theme.radius', helpKey: 'settings.theme.radius.help',
    control: { kind: 'select', optional: true, options: [{ value: 'none', labelKey: 'settings.theme.radius.none' }, { value: 'small', labelKey: 'settings.theme.radius.small' }, { value: 'medium', labelKey: 'settings.theme.radius.medium' }, { value: 'large', labelKey: 'settings.theme.radius.large' }] },
  },
  {
    section: 'theme', key: 'density', permission: 'theme.edit',
    labelKey: 'settings.theme.density', helpKey: 'settings.theme.density.help',
    control: { kind: 'select', optional: true, options: [{ value: 'compact', labelKey: 'settings.theme.density.compact' }, { value: 'comfortable', labelKey: 'settings.theme.density.comfortable' }, { value: 'spacious', labelKey: 'settings.theme.density.spacious' }] },
  },
  {
    section: 'theme', key: 'uppercaseLabels', permission: 'theme.edit',
    labelKey: 'settings.theme.uppercaseLabels', helpKey: 'settings.theme.uppercaseLabels.help',
    control: { kind: 'select', optional: true, options: [{ value: 'on', labelKey: 'settings.theme.uppercaseLabels.on' }, { value: 'off', labelKey: 'settings.theme.uppercaseLabels.off' }] },
  },
  {
    section: 'theme', key: 'shadows', permission: 'theme.edit',
    labelKey: 'settings.theme.shadows', helpKey: 'settings.theme.shadows.help',
    control: { kind: 'select', optional: true, options: [{ value: 'on', labelKey: 'settings.theme.shadows.on' }, { value: 'off', labelKey: 'settings.theme.shadows.off' }] },
  },
  {
    section: 'theme', key: 'contrast', permission: 'theme.edit',
    labelKey: 'settings.theme.contrast', helpKey: 'settings.theme.contrast.help',
    control: { kind: 'select', optional: true, options: [{ value: 'standard', labelKey: 'settings.theme.contrast.standard' }, { value: 'high', labelKey: 'settings.theme.contrast.high' }] },
  },
  {
    section: 'theme', key: 'colorMode', permission: 'theme.edit',
    labelKey: 'settings.theme.colorMode', helpKey: 'settings.theme.colorMode.help',
    control: { kind: 'select', options: [{ value: 'light', labelKey: 'settings.theme.colorMode.light' }, { value: 'dark', labelKey: 'settings.theme.colorMode.dark' }, { value: 'auto', labelKey: 'settings.theme.colorMode.auto' }] },
  },
  {
    section: 'people', key: 'passwordMinLength', permission: 'tenant.manage',
    labelKey: 'settings.people.passwordMinLength', helpKey: 'settings.people.passwordMinLength.help',
    control: { kind: 'number', min: 8, max: 128 },
  },
];
