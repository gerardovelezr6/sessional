import { z } from 'zod';

// The conference access code: a code people type before they reach the school's pages (the
// sign-in page included). Only a hash of the code is stored; the code itself is never kept.
export const CODE_HASH = /^scrypt\$[A-Za-z0-9+/=]{16,64}\$[A-Za-z0-9+/=]{40,100}$/;
export const gateSchema = z.object({
  codeHash: z.string().regex(CODE_HASH),
  // Shown under the code field: who hands out the code, per language.
  hint: z.record(z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/), z.string().max(160)).default({}),
  // Ask signed-in members too (on a new device, for example). Off: members who are signed in
  // go straight in.
  members: z.boolean().default(false),
});
export type Gate = z.infer<typeof gateSchema>;
// Codes are 4 to 64 characters; spaces at either end do not count.
export const CODE_MIN = 4;
export const CODE_MAX = 64;
