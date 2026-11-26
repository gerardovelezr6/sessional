import type { SectionName } from '@/config/schema';

// Settings an organization can copy from one of its schools to others (as drafts). Not the
// identity (each school's own name, dates and venue), its access code, website or announcements.
export const COPYABLE: SectionName[] = ['theme', 'locale', 'terminology', 'translations', 'structure', 'protocol', 'grading', 'printing', 'people', 'email', 'branding', 'legal', 'consent', 'modules'];
