// Address rules for a tenant. Mirrors app.slug_problem() in the database, which stays the authority
// (it also knows which names are reserved or taken). Shared cases are tested on both sides.
export const SLUG_MIN = 3;
export const SLUG_MAX = 40;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export function isValidSlugFormat(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && !slug.includes('--');
}
