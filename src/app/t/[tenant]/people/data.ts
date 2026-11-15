import 'server-only';
import { rpc } from '@/data/rpc';

export interface Person {
  userId: string;
  email: string;
  fullName: string;
  roleKey: string;
  roleName: Record<string, string>;
  status: 'invited' | 'active' | 'disabled';
  rank: number;
  me: boolean;
}

export interface People {
  members: Person[];
  // Roles the signed-in person may grant.
  roles: { key: string; name: Record<string, string> }[];
  myRank: number | null;
}

interface Row {
  members: { user_id: string; email: string; full_name: string; role_key: string; role_name: Record<string, string>; status: Person['status']; rank: number; me?: boolean }[];
  roles: { key: string; name: Record<string, string> }[];
  my_rank?: number | null;
}

export async function loadPeople(tenantId: string, token: string): Promise<People> {
  const row = await rpc<Row>('people_list', { p_tenant: tenantId }, { token });
  return {
    members: row.members.map((m) => ({ userId: m.user_id, email: m.email, fullName: m.full_name, roleKey: m.role_key, roleName: m.role_name, status: m.status, rank: m.rank, me: !!m.me })),
    roles: row.roles,
    myRank: row.my_rank ?? null,
  };
}
