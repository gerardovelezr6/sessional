import type { TenantConfig } from '@/config/schema';
import { standardGrading } from './presets';
import type { Grading } from './schema';

// The grading rules in force: the school's own, else the standard rubric.
// The school's rules; grading is off when the school turned the module off.
export const gradingRulesOf = (config: TenantConfig): Grading => {
  const rules = config.grading.rules ?? standardGrading();
  return config.modules.grading === 'off' ? { ...rules, enabled: false } : rules;
};
