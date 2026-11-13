import { canonicalLocale } from '@/i18n/locales';
import { catalogs } from '@/messages';
import { registry, type Setting } from './registry';
import type { SectionName } from './schema';

// Converts between a section's stored data and the fields of its settings form. The form is
// generated from the registry, so this is the only place that knows how each control is submitted.

// Languages offered for text written per language, unless the school's own list is given.
export const EDIT_LOCALES = Object.keys(catalogs);

export const settingsOf = (section: SectionName): Setting[] => registry.filter((r) => r.section === section);

export function fieldName(setting: Setting, locale?: string): string {
  return locale ? `${setting.key}.${locale}` : setting.key;
}

// Reads the submitted form into section data. Values are left as the schema will judge them: an
// empty number becomes NaN (refused), an empty translation is simply left out.
export function readForm(section: SectionName, form: FormData, locales: string[] = EDIT_LOCALES): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const setting of settingsOf(section)) {
    switch (setting.control.kind) {
      case 'number': {
        const raw = String(form.get(fieldName(setting)) ?? '').trim();
        data[setting.key] = raw === '' ? Number.NaN : Number(raw);
        break;
      }
      case 'select': {
        const raw = String(form.get(fieldName(setting)) ?? '');
        data[setting.key] = raw === '' && setting.control.optional ? null : raw;
        break;
      }
      case 'color': {
        const raw = String(form.get(fieldName(setting)) ?? '').trim();
        data[setting.key] = raw === '' ? null : raw;
        break;
      }
      case 'timeZone':
        data[setting.key] = String(form.get(fieldName(setting)) ?? '');
        break;
      case 'locale':
        data[setting.key] = String(form.get(fieldName(setting)) ?? '');
        break;
      case 'localeList': {
        // "en, ES, pt-br" -> ["en", "es", "pt-BR"]; anything unreadable is kept so the schema can refuse it.
        const raw = String(form.get(fieldName(setting)) ?? '').split(/[\s,]+/).filter(Boolean);
        data[setting.key] = raw.map((tag) => canonicalLocale(tag) ?? tag);
        break;
      }
      case 'translations':
      case 'structure':
        // Edited on its own page; the settings form never sends it.
        break;
      case 'code':
        data[setting.key] = String(form.get(fieldName(setting)) ?? '').replace(/\r\n/g, '\n').trimEnd();
        break;
      case 'asset': {
        // The stored path stays as it was unless "remove" is ticked; a newly chosen file is handled
        // by the server action (see assetFile), which then replaces this value.
        const current = String(form.get(fieldName(setting)) ?? '');
        data[setting.key] = form.get(`${fieldName(setting)}.remove`) === 'on' || current === '' ? null : current;
        break;
      }
      case 'localizedText': {
        const text: Record<string, string> = {};
        for (const locale of locales) {
          const value = String(form.get(fieldName(setting, locale)) ?? '').trim();
          if (value) text[locale] = value;
        }
        data[setting.key] = text;
        break;
      }
    }
  }
  return data;
}

// The file chosen for an image setting, if any.
export function assetFile(setting: Setting, form: FormData): File | null {
  const file = form.get(`${fieldName(setting)}.file`);
  return file instanceof File && file.size > 0 ? file : null;
}
