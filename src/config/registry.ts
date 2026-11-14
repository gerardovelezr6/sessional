import type { MessageKey } from '@/messages';
import { TERM_KEYS } from '@/i18n/terms';
import type { SectionName } from './schema';

// One entry per setting: how it is edited and described. The settings screens, CONFIG.md and the
// completeness tests are all driven from this list. A setting that exists in schema.ts but not
// here fails the tests.

export type Control =
  | { kind: 'number'; min: number; max: number }
  // optional: the setting may be left empty, meaning "as the preset has it".
  | { kind: 'select'; options: { value: string; labelKey: MessageKey }[]; optional?: boolean }
  | { kind: 'color' }
  // An uploaded image; the form sends a file, the setting stores where it was saved.
  | { kind: 'asset'; asset: 'logo' | 'favicon' }
  // Multi-line text such as CSS.
  | { kind: 'code'; maxLength: number }
  // One of the school's enabled languages; a list of language tags; the translation editor.
  | { kind: 'locale' }
  | { kind: 'localeList' }
  | { kind: 'translations' }
  // Committee categories and types: edited on their own page.
  | { kind: 'structure' }
  // The school's own rules of procedure: edited on their own page.
  | { kind: 'protocol' }
  | { kind: 'localizedText'; maxLength: number }
  | { kind: 'timeZone' };

// How a choice is shown: a row of buttons for a few short options, cards for richer ones.
export type Presentation = 'buttons' | 'cards' | 'dropdown';

export interface Setting {
  section: SectionName;
  key: string;
  // A heading the setting is listed under, within its section.
  group?: SettingGroup;
  presentation?: Presentation;
  labelKey: MessageKey;
  helpKey: MessageKey;
  // Who may change it.
  permission: string;
  control: Control;
}

export type SettingGroup = 'start' | 'brand' | 'type' | 'layout' | 'access' | 'advanced';

export const GROUP_LABELS: Record<SettingGroup, { title: MessageKey; help: MessageKey }> = {
  start: { title: 'settings.group.start', help: 'settings.group.start.help' },
  brand: { title: 'settings.group.brand', help: 'settings.group.brand.help' },
  type: { title: 'settings.group.type', help: 'settings.group.type.help' },
  layout: { title: 'settings.group.layout', help: 'settings.group.layout.help' },
  access: { title: 'settings.group.access', help: 'settings.group.access.help' },
  advanced: { title: 'settings.group.advanced', help: 'settings.group.advanced.help' },
};

// The settings menu: sections grouped the way people look for them.
export const SECTION_MENU: { label: MessageKey; sections: SectionName[] }[] = [
  { label: 'settings.menu.conference', sections: ['identity', 'theme', 'structure', 'protocol'] },
  { label: 'settings.menu.language', sections: ['locale', 'terminology', 'translations'] },
  { label: 'settings.menu.people', sections: ['people'] },
];

export const SECTION_HELP: Record<SectionName, MessageKey> = {
  identity: 'settings.identity.description',
  locale: 'settings.locale.description',
  terminology: 'settings.terminology.description',
  translations: 'settings.translations.description',
  structure: 'settings.structure.description',
  protocol: 'settings.protocol.description',
  theme: 'settings.theme.description',
  people: 'settings.people.description',
};

export const SECTION_LABELS: Record<SectionName, MessageKey> = {
  identity: 'settings.identity',
  locale: 'settings.locale',
  terminology: 'settings.terminology',
  translations: 'settings.translations',
  structure: 'settings.structure',
  protocol: 'settings.protocol',
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
    section: 'identity', key: 'dates', permission: 'tenant.manage',
    labelKey: 'settings.identity.dates', helpKey: 'settings.identity.dates.help',
    control: { kind: 'localizedText', maxLength: 120 },
  },
  {
    section: 'identity', key: 'venue', permission: 'tenant.manage',
    labelKey: 'settings.identity.venue', helpKey: 'settings.identity.venue.help',
    control: { kind: 'localizedText', maxLength: 120 },
  },
  {
    section: 'identity', key: 'timeZone', permission: 'tenant.manage',
    labelKey: 'settings.identity.timeZone', helpKey: 'settings.identity.timeZone.help',
    control: { kind: 'timeZone' },
  },
  {
    section: 'locale', key: 'enabledLocales', permission: 'tenant.manage',
    labelKey: 'settings.locale.enabledLocales', helpKey: 'settings.locale.enabledLocales.help',
    control: { kind: 'localeList' },
  },
  {
    section: 'locale', key: 'defaultLocale', permission: 'tenant.manage',
    labelKey: 'settings.locale.defaultLocale', helpKey: 'settings.locale.defaultLocale.help',
    control: { kind: 'locale' },
  },
  {
    section: 'terminology', key: 'pack', permission: 'tenant.manage', presentation: 'cards',
    labelKey: 'settings.terminology.pack', helpKey: 'settings.terminology.pack.help',
    control: {
      kind: 'select',
      options: [
        { value: 'un', labelKey: 'settings.terminology.pack.un' },
        { value: 'secretariat', labelKey: 'settings.terminology.pack.secretariat' },
        { value: 'school', labelKey: 'settings.terminology.pack.school' },
        { value: 'reglamento', labelKey: 'settings.terminology.pack.reglamento' },
      ],
    },
  },
  ...TERM_KEYS.map((key) => ({
    section: 'terminology' as const, key, permission: 'tenant.manage',
    labelKey: `settings.terminology.term.${key}` as MessageKey, helpKey: 'settings.terminology.term.help' as MessageKey,
    control: { kind: 'localizedText' as const, maxLength: 60 },
  })),
  {
    section: 'structure', key: 'categories', permission: 'tenant.manage',
    labelKey: 'settings.structure.categories', helpKey: 'settings.structure.categories.help',
    control: { kind: 'structure' },
  },
  {
    section: 'structure', key: 'types', permission: 'tenant.manage',
    labelKey: 'settings.structure.types', helpKey: 'settings.structure.types.help',
    control: { kind: 'structure' },
  },
  {
    section: 'protocol', key: 'preset', permission: 'tenant.manage', presentation: 'cards',
    labelKey: 'settings.protocol.preset', helpKey: 'settings.protocol.preset.help',
    control: { kind: 'select', options: [{ value: 'un_style', labelKey: 'settings.protocol.preset.un_style' }, { value: 'harvard_style', labelKey: 'settings.protocol.preset.harvard_style' }, { value: 'thimun_style', labelKey: 'settings.protocol.preset.thimun_style' }, { value: 'reglamento_es', labelKey: 'settings.protocol.preset.reglamento_es' }] },
  },
  {
    section: 'protocol', key: 'pack', permission: 'tenant.manage',
    labelKey: 'settings.protocol.pack', helpKey: 'settings.protocol.pack.help',
    control: { kind: 'protocol' },
  },
  {
    section: 'translations', key: 'messages', permission: 'tenant.manage',
    labelKey: 'settings.translations.messages', helpKey: 'settings.translations.messages.help',
    control: { kind: 'translations' },
  },
  {
    section: 'theme', key: 'preset', permission: 'theme.edit', group: 'start', presentation: 'cards',
    labelKey: 'settings.theme.preset', helpKey: 'settings.theme.preset.help',
    control: { kind: 'select', options: [{ value: 'sessional', labelKey: 'settings.theme.preset.sessional' }, { value: 'flat-institutional', labelKey: 'settings.theme.preset.flat-institutional' }, { value: 'classic-formal', labelKey: 'settings.theme.preset.classic-formal' }, { value: 'modern-rounded', labelKey: 'settings.theme.preset.modern-rounded' }, { value: 'high-contrast', labelKey: 'settings.theme.preset.high-contrast' }, { value: 'playful-school', labelKey: 'settings.theme.preset.playful-school' }] },
  },
  {
    section: 'theme', key: 'logo', permission: 'theme.edit', group: 'brand',
    labelKey: 'settings.theme.logo', helpKey: 'settings.theme.logo.help',
    control: { kind: 'asset', asset: 'logo' },
  },
  {
    section: 'theme', key: 'favicon', permission: 'theme.edit', group: 'brand',
    labelKey: 'settings.theme.favicon', helpKey: 'settings.theme.favicon.help',
    control: { kind: 'asset', asset: 'favicon' },
  },
  {
    section: 'theme', key: 'brand', permission: 'theme.edit', group: 'brand',
    labelKey: 'settings.theme.brand', helpKey: 'settings.theme.brand.help',
    control: { kind: 'color' },
  },
  {
    section: 'theme', key: 'accent', permission: 'theme.edit', group: 'brand',
    labelKey: 'settings.theme.accent', helpKey: 'settings.theme.accent.help',
    control: { kind: 'color' },
  },
  {
    section: 'theme', key: 'background', permission: 'theme.edit', group: 'brand',
    labelKey: 'settings.theme.background', helpKey: 'settings.theme.background.help',
    control: { kind: 'color' },
  },
  {
    section: 'theme', key: 'font', permission: 'theme.edit', group: 'type', presentation: 'cards',
    labelKey: 'settings.theme.font', helpKey: 'settings.theme.font.help',
    control: { kind: 'select', optional: true, options: [{ value: 'montserrat', labelKey: 'settings.theme.font.montserrat' }, { value: 'inter', labelKey: 'settings.theme.font.inter' }, { value: 'source-serif', labelKey: 'settings.theme.font.source-serif' }, { value: 'nunito', labelKey: 'settings.theme.font.nunito' }, { value: 'atkinson', labelKey: 'settings.theme.font.atkinson' }, { value: 'system', labelKey: 'settings.theme.font.system' }] },
  },
  {
    section: 'theme', key: 'radius', permission: 'theme.edit', group: 'type', presentation: 'buttons',
    labelKey: 'settings.theme.radius', helpKey: 'settings.theme.radius.help',
    control: { kind: 'select', optional: true, options: [{ value: 'none', labelKey: 'settings.theme.radius.none' }, { value: 'small', labelKey: 'settings.theme.radius.small' }, { value: 'medium', labelKey: 'settings.theme.radius.medium' }, { value: 'large', labelKey: 'settings.theme.radius.large' }] },
  },
  {
    section: 'theme', key: 'density', permission: 'theme.edit', group: 'type', presentation: 'buttons',
    labelKey: 'settings.theme.density', helpKey: 'settings.theme.density.help',
    control: { kind: 'select', optional: true, options: [{ value: 'compact', labelKey: 'settings.theme.density.compact' }, { value: 'comfortable', labelKey: 'settings.theme.density.comfortable' }, { value: 'spacious', labelKey: 'settings.theme.density.spacious' }] },
  },
  {
    section: 'theme', key: 'uppercaseLabels', permission: 'theme.edit', group: 'type', presentation: 'buttons',
    labelKey: 'settings.theme.uppercaseLabels', helpKey: 'settings.theme.uppercaseLabels.help',
    control: { kind: 'select', optional: true, options: [{ value: 'on', labelKey: 'settings.theme.uppercaseLabels.on' }, { value: 'off', labelKey: 'settings.theme.uppercaseLabels.off' }] },
  },
  {
    section: 'theme', key: 'shadows', permission: 'theme.edit', group: 'layout', presentation: 'buttons',
    labelKey: 'settings.theme.shadows', helpKey: 'settings.theme.shadows.help',
    control: { kind: 'select', optional: true, options: [{ value: 'on', labelKey: 'settings.theme.shadows.on' }, { value: 'off', labelKey: 'settings.theme.shadows.off' }] },
  },
  {
    section: 'theme', key: 'contrast', permission: 'theme.edit', group: 'access', presentation: 'buttons',
    labelKey: 'settings.theme.contrast', helpKey: 'settings.theme.contrast.help',
    control: { kind: 'select', optional: true, options: [{ value: 'standard', labelKey: 'settings.theme.contrast.standard' }, { value: 'high', labelKey: 'settings.theme.contrast.high' }] },
  },
  {
    section: 'theme', key: 'headerStyle', permission: 'theme.edit', group: 'layout', presentation: 'buttons',
    labelKey: 'settings.theme.headerStyle', helpKey: 'settings.theme.headerStyle.help',
    control: { kind: 'select', optional: true, options: [{ value: 'light', labelKey: 'settings.theme.headerStyle.light' }, { value: 'brand', labelKey: 'settings.theme.headerStyle.brand' }] },
  },
  {
    section: 'theme', key: 'homeBanner', permission: 'theme.edit', group: 'layout', presentation: 'buttons',
    labelKey: 'settings.theme.homeBanner', helpKey: 'settings.theme.homeBanner.help',
    control: { kind: 'select', options: [{ value: 'on', labelKey: 'settings.theme.homeBanner.on' }, { value: 'off', labelKey: 'settings.theme.homeBanner.off' }] },
  },
  {
    section: 'theme', key: 'consoleLayout', permission: 'theme.edit', group: 'layout', presentation: 'buttons',
    labelKey: 'settings.theme.consoleLayout', helpKey: 'settings.theme.consoleLayout.help',
    control: { kind: 'select', options: [{ value: 'tabs', labelKey: 'settings.theme.consoleLayout.tabs' }, { value: 'single', labelKey: 'settings.theme.consoleLayout.single' }] },
  },
  {
    section: 'theme', key: 'pageTitle', permission: 'theme.edit', group: 'layout', presentation: 'buttons',
    labelKey: 'settings.theme.pageTitle', helpKey: 'settings.theme.pageTitle.help',
    control: { kind: 'select', optional: true, options: [{ value: 'plain', labelKey: 'settings.theme.pageTitle.plain' }, { value: 'bar', labelKey: 'settings.theme.pageTitle.bar' }] },
  },
  {
    section: 'theme', key: 'tabStyle', permission: 'theme.edit', group: 'layout', presentation: 'buttons',
    labelKey: 'settings.theme.tabStyle', helpKey: 'settings.theme.tabStyle.help',
    control: { kind: 'select', optional: true, options: [{ value: 'underline', labelKey: 'settings.theme.tabStyle.underline' }, { value: 'pill', labelKey: 'settings.theme.tabStyle.pill' }, { value: 'boxed', labelKey: 'settings.theme.tabStyle.boxed' }] },
  },
  {
    section: 'theme', key: 'colorMode', permission: 'theme.edit', group: 'access', presentation: 'buttons',
    labelKey: 'settings.theme.colorMode', helpKey: 'settings.theme.colorMode.help',
    control: { kind: 'select', options: [{ value: 'light', labelKey: 'settings.theme.colorMode.light' }, { value: 'dark', labelKey: 'settings.theme.colorMode.dark' }, { value: 'auto', labelKey: 'settings.theme.colorMode.auto' }] },
  },
  {
    section: 'theme', key: 'customCss', permission: 'theme.edit', group: 'advanced',
    labelKey: 'settings.theme.customCss', helpKey: 'settings.theme.customCss.help',
    control: { kind: 'code', maxLength: 10000 },
  },
  {
    section: 'people', key: 'passwordMinLength', permission: 'tenant.manage',
    labelKey: 'settings.people.passwordMinLength', helpKey: 'settings.people.passwordMinLength.help',
    control: { kind: 'number', min: 8, max: 128 },
  },
];
