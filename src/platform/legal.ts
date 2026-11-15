import 'server-only';

// Who runs Sessional, for the privacy policy and terms. Set in the hosting settings (Vercel →
// Environment Variables), never in code: LEGAL_OPERATOR (a person or company name),
// LEGAL_CONTACT_EMAIL and LEGAL_COUNTRY (whose law applies). Until set, the pages say so plainly.
export const LEGAL_UPDATED = '2026-11-15';

export function legalDetails() {
  const value = (name: string) => process.env[name]?.trim() || `[${name}]`;
  return {
    operator: value('LEGAL_OPERATOR'),
    email: value('LEGAL_CONTACT_EMAIL'),
    country: value('LEGAL_COUNTRY'),
    complete: ['LEGAL_OPERATOR', 'LEGAL_CONTACT_EMAIL', 'LEGAL_COUNTRY'].every((n) => !!process.env[n]?.trim()),
  };
}
