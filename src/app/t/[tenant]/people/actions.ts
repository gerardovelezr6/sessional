'use server';
import { generateLink } from '@/auth/gotrue';
import { rpc, RpcError, verifiedWrite, WriteNotApplied } from '@/data/rpc';
import type { FormState } from '@/components/ActionForm';
import { tenantTranslator } from '@/config/store';
import { STARTER_ROLES } from '@/presets/roles';
import { basePath, requireTenant, tenantContext, tenantOrigin } from '@/tenancy/context';
import { loadPeople } from './data';

export interface InviteState {
  error?: string;
  // Shown only after the server confirmed the write.
  message?: string;
  link?: string;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function setPasswordLink(email: string, fullName: string): Promise<string | null> {
  let type: 'invite' | 'recovery' = 'invite';
  let link = await generateLink('invite', email, { full_name: fullName });
  // An account that was confirmed earlier but never chose a password gets a reset link instead.
  if (!link.ok && link.reason === 'exists') {
    type = 'recovery';
    link = await generateLink('recovery', email);
  }
  if (!link.ok) return null;
  return `${await tenantOrigin()}/set-password?token_hash=${encodeURIComponent(link.value.tokenHash)}&type=${type}`;
}

// Invites a person, or (resendFor) issues a fresh link to someone already invited.
async function invite(tenantKey: string, input: { email: string; fullName: string; roleKey: string } | { resendFor: string }): Promise<InviteState> {
  const tenant = await requireTenant(tenantKey);
  const { t } = await tenantTranslator(tenant.id);
  const ctx = await tenantContext(tenant.id);
  if (!ctx?.can('users.manage')) return { error: t('people.invite.error.forbidden') };

  try {
    const people = await loadPeople(tenant.id, ctx.token);
    let email: string;
    let fullName = '';
    let roleKey = '';
    const resend = 'resendFor' in input;
    if (resend) {
      const member = people.members.find((m) => m.userId === input.resendFor && m.status === 'invited');
      if (!member) return { error: t('people.invite.error.failed') };
      email = member.email;
      fullName = member.fullName;
    } else {
      email = input.email.trim().toLowerCase();
      fullName = input.fullName.trim().slice(0, 200);
      roleKey = input.roleKey;
      if (!EMAIL.test(email) || email.length > 254) return { error: t('people.invite.error.email') };
      // Checked before any account is created; the database checks again on the write.
      if (!people.roles.some((r) => r.key === roleKey)) return { error: t('people.invite.error.role') };
    }

    const account = await rpc<{ id: string; password_set: boolean } | null>('find_account', { p_email: email }, 'service');
    const add = async (userId: string, status: 'invited' | 'active') =>
      verifiedWrite(
        await rpc<{ user_id: string } | null>('add_member', { p_tenant: tenant.id, p_user: userId, p_role: roleKey, p_status: status }, { token: ctx.token }),
        'add_member',
      );

    if (account?.password_set) {
      // Already uses the product (another school, or an earlier year): access starts now.
      if (!resend) await add(account.id, 'active');
      return { message: t('people.invite.existing', { email }), link: `${await tenantOrigin()}/login` };
    }

    if (account && !resend) await add(account.id, 'invited');
    if (!account) {
      const created = await generateLink('invite', email, { full_name: fullName });
      if (!created.ok) return { error: t('people.invite.error.failed') };
      await add(created.value.userId, 'invited');
      return {
        message: t('people.invite.ready', { email }),
        link: `${await tenantOrigin()}/set-password?token_hash=${encodeURIComponent(created.value.tokenHash)}&type=invite`,
      };
    }
    const link = await setPasswordLink(email, fullName);
    if (!link) return { error: t('people.invite.error.failed') };
    return { message: t('people.invite.ready', { email }), link };
  } catch (e) {
    if (e instanceof RpcError && e.duplicate) return { error: t('people.invite.error.member') };
    if (e instanceof RpcError && e.forbidden) return { error: t('people.invite.error.forbidden') };
    if (e instanceof RpcError || e instanceof WriteNotApplied) {
      console.error(JSON.stringify({ event: 'invite_failed', reason: e.message.slice(0, 200) }));
      return { error: t('people.invite.error.failed') };
    }
    throw e;
  }
}

export async function inviteAction(tenantKey: string, _state: InviteState, data: FormData): Promise<InviteState> {
  return invite(tenantKey, {
    email: String(data.get('email') ?? ''),
    fullName: String(data.get('full_name') ?? ''),
    roleKey: String(data.get('role') ?? ''),
  });
}

export async function newLinkAction(tenantKey: string, userId: string): Promise<InviteState> {
  return invite(tenantKey, { resendFor: userId });
}

// Gives a school that only has the Owner role the usual starting set.
export async function addStarterRolesAction(tenantKey: string): Promise<FormState> {
  const tenant = await requireTenant(tenantKey);
  const { t } = await tenantTranslator(tenant.id);
  const ctx = await tenantContext(tenant.id);
  if (!ctx?.can('roles.manage')) return { error: t('people.invite.error.forbidden') };
  try {
    const result = verifiedWrite(await rpc<{ added: number } | null>('apply_role_preset', { p_tenant: tenant.id, p_roles: STARTER_ROLES }, { token: ctx.token }), 'apply_role_preset');
    if (result.added === 0) return { error: t('people.roles.error.failed') };
  } catch (e) {
    if (e instanceof RpcError && e.forbidden) return { error: t('people.invite.error.forbidden') };
    if (e instanceof RpcError || e instanceof WriteNotApplied) return { error: t('people.roles.error.failed') };
    throw e;
  }
  return { redirectTo: `${await basePath()}/people` };
}
