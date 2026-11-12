import { describe, expect, it } from 'vitest';
import { expiryOf, needsRefresh } from '@/auth/tokens';
import { localize, translator } from '@/messages';

const token = (payload: object) => `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`;
const NOW = 1_800_000_000;

describe('access token expiry', () => {
  it('reads exp', () => expect(expiryOf(token({ exp: NOW }))).toBe(NOW));
  it.each([undefined, '', 'garbage', 'a.b.c', token({}), token({ exp: 'soon' })])('answers null for %s', (t) => expect(expiryOf(t)).toBeNull());
});

describe('needsRefresh', () => {
  it('never without a refresh token', () => expect(needsRefresh(undefined, undefined, NOW)).toBe(false));
  it('when the access token is missing or unreadable', () => {
    expect(needsRefresh(undefined, 'r', NOW)).toBe(true);
    expect(needsRefresh('garbage', 'r', NOW)).toBe(true);
  });
  it('when it expires within a minute, or already has', () => {
    expect(needsRefresh(token({ exp: NOW + 30 }), 'r', NOW)).toBe(true);
    expect(needsRefresh(token({ exp: NOW - 30 }), 'r', NOW)).toBe(true);
  });
  it('not while it has time left', () => expect(needsRefresh(token({ exp: NOW + 600 }), 'r', NOW)).toBe(false));
});

describe('messages', () => {
  it('fills placeholders', () => {
    expect(translator('en')('home.role', { role: 'Chair' })).toBe('Your role: Chair');
    expect(translator('es')('setPassword.hint', { min: 8 })).toBe('Al menos 8 caracteres.');
  });
  it('localizes tenant content with fallbacks', () => {
    expect(localize({ en: 'Chair', es: 'Mesa' }, 'es')).toBe('Mesa');
    expect(localize({ en: 'Chair' }, 'es')).toBe('Chair');
    expect(localize({ fr: 'Président' }, 'es')).toBe('Président');
    expect(localize(null, 'en', 'chair')).toBe('chair');
  });
});
