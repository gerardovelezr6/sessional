// Every permission the product knows, grouped as the roles page shows them. A role holds any set
// of these; 'committee' permissions apply only to the committees a person is assigned to when
// their role's scope is "assigned". The database decides on each one (see the permission matrix
// in tests/db/permissions.test.ts).
export type PermissionGroup = 'people' | 'conference' | 'committees' | 'grades';
export interface Permission {
  key: string;
  group: PermissionGroup;
  scope: 'tenant' | 'committee';
  // Holding this permission also grants these (you cannot manage what you cannot see).
  includes?: string[];
}

export const PERMISSIONS: Permission[] = [
  { key: 'users.view', group: 'people', scope: 'tenant' },
  { key: 'users.manage', group: 'people', scope: 'tenant', includes: ['users.view'] },
  { key: 'roles.manage', group: 'people', scope: 'tenant' },
  { key: 'audit.view', group: 'people', scope: 'tenant' },
  { key: 'tenant.manage', group: 'conference', scope: 'tenant' },
  { key: 'conference.manage', group: 'conference', scope: 'tenant' },
  { key: 'committee.manage', group: 'committees', scope: 'tenant', includes: ['crisis.view', 'delegates.manage'] },
  { key: 'crisis.view', group: 'committees', scope: 'tenant' },
  { key: 'committee.run', group: 'committees', scope: 'committee' },
  { key: 'delegates.manage', group: 'committees', scope: 'committee' },
  { key: 'grades.view', group: 'grades', scope: 'tenant' },
  { key: 'grades.manage', group: 'grades', scope: 'committee' },
];
export const PERMISSION_GROUPS: PermissionGroup[] = ['people', 'conference', 'committees', 'grades'];

// What a set of permissions amounts to, with what each one includes.
export function effectivePermissions(held: string[]): Set<string> {
  const out = new Set(held);
  for (const p of PERMISSIONS) if (out.has(p.key)) for (const i of p.includes ?? []) out.add(i);
  return out;
}
