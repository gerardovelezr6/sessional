import 'server-only';
import { notFound } from 'next/navigation';
import { accessToken } from '@/auth/session';
import { rpc } from '@/data/rpc';

// The admin host answers only platform admins. Anyone else, signed in or not, gets "not found" on
// every page but the sign-in page, which itself never says whether an account is an admin.

export async function isPlatformAdmin(token: string | null): Promise<boolean> {
  if (!token) return false;
  return rpc<boolean>('am_platform_admin', {}, { token }).catch(() => false);
}

export async function requireAdmin(): Promise<{ token: string }> {
  const token = await accessToken();
  if (!token || !(await isPlatformAdmin(token))) notFound();
  return { token };
}
