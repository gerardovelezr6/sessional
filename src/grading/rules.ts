import type { TenantConfig } from '@/config/schema';
import { standardGrading } from './presets';
import type { Grading } from './schema';

// The grading rules in force: the school's own, else the standard rubric.
// The school's rules; grading is off when the school turned the module off.
export const gradingRulesOf = (config: TenantConfig): Grading => {
  const saved = config.grading.rules;
  // Rules saved before American spelling still say "Honourable"; show it the way it is spelled now.
  const rules = saved ? { ...saved, awards: saved.awards.map((a) => (a.name.en === 'Honourable Mention' ? { ...a, name: { ...a.name, en: 'Honorable Mention' } } : a)) } : standardGrading();
  return config.modules.grading === 'off' ? { ...rules, enabled: false } : rules;
};
