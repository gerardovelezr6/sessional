'use server';
import { cookies } from 'next/headers';
import { cookieOptions } from '@/auth/cookies';
import { DISPLAY_COOKIE, formatDisplay } from '@/a11y/display';
import type { FormState } from '@/components/ActionForm';

// Saves the person's display needs on this device. The page renders again with them.
export async function setDisplayAction(_s: FormState, form: FormData): Promise<FormState> {
  const value = formatDisplay({ contrast: form.get('contrast') === 'on', large: form.get('large') === 'on' });
  const jar = await cookies();
  if (value) jar.set(DISPLAY_COOKIE, value, cookieOptions(60 * 60 * 24 * 365));
  else jar.delete(DISPLAY_COOKIE);
  return {};
}
