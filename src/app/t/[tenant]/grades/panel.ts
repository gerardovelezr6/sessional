import 'server-only';
import type { TenantConfig } from '@/config/schema';
import type { Grading } from '@/grading/schema';
import type { FlagChoice } from '@/structure/flags';
import { localize, messageFor, type MessageKey, type Translate } from '@/messages';
import { addGradeAction, consoleGradesAction, deleteGradeAction } from './actions';

// What the grading panel needs, for the console and the committee's Grades tab alike.
const WORDS = ['title', 'who', 'speaking', 'category', 'level', 'note', 'notePlaceholder', 'pickFirst', 'saving', 'leaders', 'recent', 'noneYet', 'remove', 'removeConfirm', 'removed', 'keep', 'noRubric', 'error_forbidden', 'error_invalid', 'error_failed'] as const;

export function gradingPanelProps(o: { tenantKey: string; committeeId: string; rules: Grading; delegates: { id: string; label: string; flag: FlagChoice; logoUrl: string | null }[]; config: TenantConfig; locale: string; t: Translate }) {
  const pattern = (k: MessageKey) => messageFor(k, o.locale, o.config.translations.messages).text;
  return {
    rubric: o.rules.categories.map((c) => ({
      key: c.key,
      name: localize(c.name, o.locale, c.key),
      short: c.short,
      hint: localize(c.hint, o.locale, ''),
      levels: c.levels.map((l) => ({ key: l.key, label: localize(l.label, o.locale, l.key), description: localize(l.description, o.locale, ''), points: l.points * c.weight })),
    })),
    delegates: o.delegates,
    add: addGradeAction.bind(null, o.tenantKey, o.committeeId),
    remove: deleteGradeAction.bind(null, o.tenantKey),
    load: consoleGradesAction.bind(null, o.tenantKey, o.committeeId),
    locale: o.locale,
    L: { points: pattern('grading.points'), given: pattern('grading.given'), giveLevel: pattern('grading.giveLevel'), removeOne: pattern('grading.removeOne'), ...Object.fromEntries(WORDS.map((k) => [k, o.t(`grading.${k}` as MessageKey)])) },
  };
}
