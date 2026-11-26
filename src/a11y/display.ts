import 'server-only';
import { cookies } from 'next/headers';

// A person's own display needs, on this device: more contrast and larger text. Kept in a cookie so
// the first HTML already has them (no flash), whoever is signed in. Separate from the school's
// design, which stays as the school chose it for everyone else.
export const DISPLAY_COOKIE = 's_display';

export interface DisplayPrefs {
  contrast: boolean;
  large: boolean;
}

export function parseDisplay(value: string | undefined): DisplayPrefs {
  const parts = new Set((value ?? '').split(','));
  return { contrast: parts.has('contrast'), large: parts.has('large') };
}

export const formatDisplay = (p: DisplayPrefs) => [p.contrast ? 'contrast' : '', p.large ? 'large' : ''].filter(Boolean).join(',');

export async function displayPrefs(): Promise<DisplayPrefs> {
  return parseDisplay((await cookies()).get(DISPLAY_COOKIE)?.value);
}
