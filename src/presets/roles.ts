// The starter roles offered to a new school. They are a preset, not a rule: once added they are
// ordinary tenant data that the school can rename, change or delete. Phase 2 turns presets like
// this into packs that can be exported, imported and shared.

export interface RolePreset {
  key: string;
  name: Record<string, string>;
  rank: number;
  scope: 'tenant' | 'assigned';
  permissions: string[];
}

const MANAGEMENT = ['users.view', 'users.manage', 'roles.manage', 'conference.manage', 'tenant.manage', 'audit.view'];

export const STARTER_ROLES: RolePreset[] = [
  { key: 'advisor', name: { en: 'Advisor', es: 'Asesor' }, rank: 10, scope: 'tenant', permissions: MANAGEMENT },
  { key: 'high_command', name: { en: 'High Command', es: 'Alto Mando' }, rank: 20, scope: 'tenant', permissions: MANAGEMENT },
  { key: 'chair', name: { en: 'Chair', es: 'Mesa' }, rank: 30, scope: 'assigned', permissions: [] },
];
