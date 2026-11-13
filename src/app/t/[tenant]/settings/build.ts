import { fieldName, settingsOf } from '@/config/form';
import { GROUP_LABELS, type SettingGroup } from '@/config/registry';
import { type SectionName } from '@/config/schema';
import { assetUrl } from '@/data/storage';
import { COMMON_LANGUAGES } from '@/i18n/language-list';
import { directionOf, languageName } from '@/i18n/locales';
import { TERM_KEYS, TERM_PACKS, type TermPackKey } from '@/i18n/terms';
import { timeZoneGroups } from '@/i18n/time-zones';
import type { MessageKey, Translate } from '@/messages';
import { ACCENT_SWATCHES, BACKGROUND_SWATCHES, BRAND_SWATCHES } from '@/theme/swatches';
import { FONT_STACKS, PRESETS, type FontKey, type PresetKey, type ThemeChoice } from '@/theme/presets';
import type { FieldGroup } from './SectionForm';
import type { FieldView, Option } from './fields';

// Builds the groups and fields of a section's form from the registry and the values being edited.

export interface BuildContext {
  t: Translate;
  tenantId: string;
  // The school's languages as being edited, and the reader's language (for names).
  locales: string[];
  uiLocale: string;
}

const SWATCHES: Record<string, string[]> = { brand: BRAND_SWATCHES, accent: ACCENT_SWATCHES, background: BACKGROUND_SWATCHES };
const GROUP_ORDER: SettingGroup[] = ['start', 'brand', 'type', 'layout', 'access', 'advanced'];

const nameIn = (code: string, uiLocale: string) => {
  const own = languageName(code, code);
  const here = languageName(code, uiLocale);
  return own.toLowerCase() === here.toLowerCase() ? here : `${here} (${own})`;
};

function fieldsFor(section: SectionName, values: Record<string, unknown>, ctx: BuildContext): FieldView[] {
  const { t, locales, uiLocale } = ctx;
  const out: FieldView[] = [];
  const preset = PRESETS[(values.preset as PresetKey) ?? 'sessional'] ?? PRESETS.sessional;

  for (const setting of settingsOf(section)) {
    const value = values[setting.key];
    const base = { settingKey: setting.key, label: t(setting.labelKey), help: t(setting.helpKey) };
    const name = fieldName(setting);
    const c = setting.control;
    switch (c.kind) {
      case 'translations':
      case 'structure':
      case 'locale':
        break; // shown with the list of languages, or on its own page
      case 'localeList':
        out.push({
          ...base,
          kind: 'languages',
          errorKeys: ['defaultLocale'],
          name,
          defaultName: 'defaultLocale',
          value: value as string[],
          defaultValue: String(values.defaultLocale ?? ''),
          catalog: [...new Set([...(value as string[]), ...COMMON_LANGUAGES])].map((code) => ({ code, label: nameIn(code, uiLocale) })).sort((a, b) => a.label.localeCompare(b.label, uiLocale)),
        });
        break;
      case 'number':
        out.push({ ...base, kind: 'number', name, value: String(value), min: c.min, max: c.max });
        break;
      case 'select': {
        const options: Option[] = c.options.map((o) => ({ value: o.value, label: t(o.labelKey) }));
        if (section === 'terminology' && setting.key === 'pack') {
          const packs = options.map((o) => {
            const words = Object.fromEntries(Object.entries(TERM_PACKS[o.value as TermPackKey]).map(([lang, w]) => [lang, w as Record<string, string>]));
            const en = TERM_PACKS[o.value as TermPackKey].en;
            const example = (TERM_PACKS[o.value as TermPackKey] as Record<string, typeof en>)[uiLocale.split('-')[0]!] ?? en;
            return { ...o, label: t(`settings.terminology.pack.${o.value}` as MessageKey).split(' (')[0]!, description: t('settings.pack.example', { chair: example.chair, delegate: example.delegate, highCommand: example.highCommand }), words };
          });
          out.push({
            ...base,
            kind: 'terms',
            packName: name,
            packValue: String(value),
            packs,
            terms: TERM_KEYS.map((k) => ({ key: k, label: t(`settings.terminology.term.${k}` as MessageKey) })),
            locales: locales.map((l) => ({ code: l, label: nameIn(l, uiLocale), dir: directionOf(l) })),
            values: Object.fromEntries(TERM_KEYS.map((k) => [k, (values[k] ?? {}) as Record<string, string>])),
          });
          break;
        }
        if (c.optional) options.unshift({ value: '', label: t('settings.fromPreset') });
        const current = value === null || value === undefined ? '' : String(value);
        if (setting.key === 'preset') {
          for (const o of options) {
            const p = PRESETS[o.value as PresetKey];
            if (p) Object.assign(o, { swatches: [p.brand, p.accent, p.background], fontFamily: FONT_STACKS[p.font] });
          }
        }
        if (section === 'protocol') for (const o of options) o.description = t(`settings.protocol.preset.${o.value}.help` as MessageKey);
        if (setting.key === 'font') for (const o of options) if (o.value) o.fontFamily = FONT_STACKS[o.value as FontKey];
        const kind = setting.presentation === 'cards' ? 'cards' : setting.presentation === 'buttons' ? 'buttons' : 'select';
        out.push({ ...base, kind, name, value: current, options });
        break;
      }
      case 'color':
        out.push({ ...base, kind: 'color', name, value: value ? String(value) : '', presetValue: preset[setting.key as 'brand' | 'accent' | 'background'], swatches: SWATCHES[setting.key] ?? BRAND_SWATCHES });
        break;
      case 'asset': {
        const path = typeof value === 'string' ? value : '';
        out.push({ ...base, kind: 'asset', name, value: path, currentUrl: assetUrl(ctx.tenantId, path), accept: c.asset === 'favicon' ? 'image/png' : 'image/png,image/jpeg,image/webp' });
        break;
      }
      case 'code':
        out.push({ ...base, kind: 'textarea', name, value: String(value ?? ''), maxLength: c.maxLength });
        break;
      case 'timeZone':
        out.push({ ...base, kind: 'select', name, value: String(value), optionGroups: timeZoneGroups(uiLocale).map((g) => ({ label: g.label, options: g.zones })) });
        break;
      case 'localizedText': {
        if (section === 'terminology') break; // part of the words table
        const text = (value ?? {}) as Record<string, string>;
        out.push({
          ...base,
          kind: 'localized',
          inputs: locales.map((l) => ({ name: fieldName(setting, l), caption: nameIn(l, uiLocale), value: text[l] ?? '', maxLength: c.maxLength, lang: l, dir: directionOf(l) })),
        });
        break;
      }
    }
  }
  return out;
}

export function sectionGroups(section: SectionName, values: Record<string, unknown>, ctx: BuildContext): FieldGroup[] {
  const fields = fieldsFor(section, values, ctx);
  const groupOf = (key: string) => settingsOf(section).find((s) => s.key === key)?.group;
  if (!settingsOf(section).some((s) => s.group)) return [{ id: section, fields }];
  return GROUP_ORDER.map((g) => ({
    id: g,
    title: ctx.t(GROUP_LABELS[g].title),
    help: ctx.t(GROUP_LABELS[g].help),
    collapsed: g === 'advanced',
    open: g === 'advanced' && !!(values as Partial<ThemeChoice>).customCss,
    fields: fields.filter((f) => groupOf(f.settingKey) === g),
  })).filter((g) => g.fields.length);
}
