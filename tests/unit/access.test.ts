import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { CODE_HASH, gateSchema } from '@/access/schema';

let code: typeof import('@/access/code');
beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-secret-for-tests';
  code = await import('@/access/code');
});

describe('the access code', () => {
  it('is stored only as a salted hash that the settings accept', () => {
    const a = code.hashCode('Delegates2027');
    const b = code.hashCode('Delegates2027');
    expect(a).not.toContain('Delegates2027');
    expect(a).not.toBe(b);
    expect(a).toMatch(CODE_HASH);
    expect(gateSchema.safeParse({ codeHash: a }).success).toBe(true);
    expect(gateSchema.safeParse({ codeHash: 'Delegates2027' }).success).toBe(false);
  });
  it('accepts the right code (spaces around it do not count) and nothing else', () => {
    const h = code.hashCode('Delegates2027');
    expect(code.checkCode(' Delegates2027 ', h)).toBe(true);
    expect(code.checkCode('delegates2027', h)).toBe(false);
    expect(code.checkCode('', h)).toBe(false);
    expect(code.checkCode('x', 'plain$text')).toBe(false);
  });
  it('the cookie opens one school, for the current code only', () => {
    const h = code.hashCode('one');
    const pass = code.passFor('school-a', h);
    expect(code.passValid(pass, 'school-a', h)).toBe(true);
    expect(code.passValid(pass, 'school-b', h)).toBe(false);
    expect(code.passValid(pass, 'school-a', code.hashCode('one'))).toBe(false);
    expect(code.passValid(`${pass}x`, 'school-a', h)).toBe(false);
    expect(code.passValid(undefined, 'school-a', h)).toBe(false);
  });
});
