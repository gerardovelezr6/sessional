// What went wrong with a Google or Microsoft sign-in, in words people can act on. The provider and
// the authentication service report errors as codes in the address; these are the ones people meet.
export type SignInProblem = 'cancelled' | 'expired' | 'provider' | 'unavailable';

export function problemOf(errorCode: string | null, error: string | null): SignInProblem {
  const code = (errorCode || error || '').toLowerCase();
  if (code === 'access_denied' || code === 'user_cancelled' || code === 'consent_required') return 'cancelled';
  // The same sign-in finished twice (back button, reload, double click), or it took too long.
  if (/^(flow_state_already_used|flow_state_not_found|flow_state_expired|bad_code_verifier|bad_oauth_state|bad_oauth_callback)$/.test(code)) return 'expired';
  if (code === 'temporarily_unavailable' || code === 'server_error' || code === 'over_request_rate_limit') return 'unavailable';
  return 'provider';
}

export const SIGN_IN_PROBLEMS: SignInProblem[] = ['cancelled', 'expired', 'provider', 'unavailable'];
