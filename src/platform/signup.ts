import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { LEGAL_UPDATED } from './legal';

// Self-serve signup. A school is created only from the link we email, so an address can't be used
// by someone who doesn't own it, and a bot that never reads email creates nothing.

export const signupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().max(254).pipe(z.email()),
  school: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]([a-z0-9-]{1,38})[a-z0-9]$/)
    .refine((s) => !s.includes('--')),
  locale: z.enum(['en', 'es']),
  adult: z.literal('on'),
  terms: z.literal('on'),
});
export type SignupField = keyof z.infer<typeof signupSchema>;

// An address from a school's name: "Colegio Americano de Monterrey" → "colegio-americano-de-monterrey".
export function slugFrom(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return s.length >= 3 ? s : '';
}

export function parseSignup(data: FormData): { ok: true; value: z.infer<typeof signupSchema> } | { ok: false; fields: SignupField[] } {
  const raw = Object.fromEntries(Object.keys(signupSchema.shape).map((k) => [k, String(data.get(k) ?? '')]));
  if (!raw.slug) raw.slug = slugFrom(raw.school ?? '');
  const r = signupSchema.safeParse(raw);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, fields: [...new Set(r.error.issues.map((i) => i.path[0] as SignupField))] };
}

export const TERMS_VERSION = LEGAL_UPDATED;
export const secret = () => randomBytes(32).toString('hex');
export const hashOf = (s: string) => createHash('sha256').update(s).digest('hex');
export const isSecret = (s: string) => /^[0-9a-f]{64}$/.test(s);
