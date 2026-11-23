import { describe, expect, it } from 'vitest';
import { problemOf } from '@/auth/oauth-errors';

describe('sign-in problems', () => {
  it('turns the codes people meet into something they can act on', () => {
    expect(problemOf('flow_state_already_used', 'invalid_request')).toBe('expired');
    expect(problemOf('flow_state_expired', null)).toBe('expired');
    expect(problemOf(null, 'access_denied')).toBe('cancelled');
    expect(problemOf(null, 'temporarily_unavailable')).toBe('unavailable');
    expect(problemOf('something_new', 'invalid_request')).toBe('provider');
    expect(problemOf(null, null)).toBe('provider');
  });
});
