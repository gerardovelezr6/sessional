import type { TenantConfig } from '@/config/schema';
import { standardGrading } from './presets';
import type { Grading } from './schema';

// The grading rules in force: the school's own, else the standard rubric.
export const gradingRulesOf = (config: TenantConfig): Grading => config.grading.rules ?? standardGrading();
