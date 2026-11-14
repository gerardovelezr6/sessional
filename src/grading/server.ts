import 'server-only';
import { rpc } from '@/data/rpc';
import type { GradingData } from './standings';

// Reading a committee's grading data with the person's own rights: null when they may not.
export const loadGrading = (committeeId: string, token: string) => rpc<GradingData | null>('grading_data', { p_committee: committeeId }, { token });

export interface Mapping {
  id: string;
  name: string;
  format: 'csv' | 'xlsx' | 'pdf';
  columns: { key: string; header?: string }[];
  updated_at: string;
}
export const loadMappings = (tenantId: string, token: string) => rpc<Mapping[]>('export_mappings_list', { p_tenant: tenantId }, { token });
