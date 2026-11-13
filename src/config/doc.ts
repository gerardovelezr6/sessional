import { catalogs, type MessageKey } from '@/messages';
import { registry, SECTION_LABELS, type Setting } from './registry';
import { SECTION_NAMES, sectionDefaults, type SectionName } from './schema';

// Builds docs/CONFIG.md from the registry and the schema, so the list of settings can never
// drift from the code. `npm run config:doc` rewrites it; a unit test fails when it is stale.

const en = (key: MessageKey) => (catalogs.en as Record<string, string>)[key] ?? key;
const es = (key: MessageKey) => (catalogs.es as Record<string, string>)[key] ?? key;
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function allowed(setting: Setting): string {
  const c = setting.control;
  switch (c.kind) {
    case 'number':
      return `whole number, ${c.min} to ${c.max}`;
    case 'select':
      return `${c.options.map((o) => `\`${o.value}\` (${en(o.labelKey)})`).join(', ')}${c.optional ? '; empty = as the preset has it' : ''}`;
    case 'color':
      return 'colour as `#RRGGBB`; empty = as the preset has it';
    case 'localizedText':
      return `text per language, up to ${c.maxLength} characters each`;
    case 'timeZone':
      return 'an IANA time zone, e.g. `America/Mexico_City`';
    case 'asset':
      return c.asset === 'favicon' ? 'uploaded square PNG, 32 to 1024 px' : 'uploaded PNG, JPEG or WebP, up to 2 MB';
    case 'code':
      return `CSS, up to ${c.maxLength} characters, checked by the custom CSS rules`;
    case 'locale':
      return 'one of the enabled languages';
    case 'localeList':
      return 'language codes (BCP 47), e.g. `en, es, fr`';
    case 'translations':
      return 'edited in the translation editor; each text must keep the English placeholders';
  }
}

const shown = (value: unknown) => {
  if (value === null) return 'as the preset has it';
  if (value === '') return '(empty)';
  if (typeof value === 'object') return Object.keys(value as object).length ? `\`${JSON.stringify(value)}\`` : '(none)';
  return `\`${String(value)}\``;
};

export function renderConfigDoc(): string {
  const lines = [
    '# Settings',
    '',
    'Every setting a school can change, generated from `src/config/registry.ts` and',
    '`src/config/schema.ts`. Do not edit by hand: run `npm run config:doc`.',
    '',
    'Each setting is saved as a draft, previewed, then published as a new version of its section;',
    'every version is kept and can be restored. See `docs/ARCHITECTURE.md`, "Configuration".',
    '',
  ];
  for (const section of SECTION_NAMES as SectionName[]) {
    const defaults = sectionDefaults(section) as Record<string, unknown>;
    lines.push(`## ${en(SECTION_LABELS[section])} (\`${section}\`)`, '', `Spanish: ${es(SECTION_LABELS[section])}`, '');
    lines.push('| Setting | Key | Default | Allowed | Who can change | What it does |', '|---|---|---|---|---|---|');
    for (const setting of registry.filter((r) => r.section === section)) {
      lines.push(
        `| ${cell(en(setting.labelKey))} | \`${section}.${setting.key}\` | ${cell(shown(defaults[setting.key]))} | ${cell(allowed(setting))} | \`${setting.permission}\` | ${cell(en(setting.helpKey))} |`,
      );
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
