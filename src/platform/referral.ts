// A partner's link (?ref=CODE on any page of the main website) is remembered for 30 days, so the
// school is theirs even if it signs up later. The code is checked when the signup is filed.
export const REFERRAL_COOKIE = 's_ref';
export const REFERRAL_MAX_AGE = 60 * 60 * 24 * 30;
export const referralCode = (value: string | null | undefined): string | null => {
  const code = String(value ?? '').trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9-]{2,29}$/.test(code) ? code : null;
};
