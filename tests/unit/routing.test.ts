import { describe, expect, it } from 'vitest';
import { classifyHost, hostnameOf } from '@/tenancy/host';
import { decideRoute, parseTenantKey } from '@/tenancy/route';
import { isValidSlugFormat } from '@/tenancy/slug';

const ROOT = 'sessional.app';

describe('slug format (same cases as the database test)', () => {
  it.each(['ab', '-abc', 'abc-', 'Abc', 'a_b_c', 'xn--abc', 'a--b', 'a'.repeat(41), 'ñandu', 'a.b', ''])('rejects %s', (s) => {
    expect(isValidSlugFormat(s)).toBe(false);
  });
  it.each(['abc', 'school-2027', 'a1b', 'a'.repeat(40), '123'])('accepts %s', (s) => {
    expect(isValidSlugFormat(s)).toBe(true);
  });
});

describe('hostnameOf', () => {
  it.each([
    ['Alpha.Sessional.App:443', 'alpha.sessional.app'],
    ['sessional.app.', 'sessional.app'],
    ['localhost:3000', 'localhost'],
    [null, ''],
  ])('%s -> %s', (input, out) => expect(hostnameOf(input)).toBe(out));
});

describe('classifyHost', () => {
  it.each([
    ['sessional.app', { kind: 'marketing' }],
    ['www.sessional.app', { kind: 'marketing' }],
    ['SESSIONAL.APP:443', { kind: 'marketing' }],
    ['app.sessional.app', { kind: 'platform', area: 'app' }],
    ['admin.sessional.app', { kind: 'platform', area: 'admin' }],
    ['myschool.sessional.app', { kind: 'tenant', slug: 'myschool' }],
    ['MySchool.sessional.app', { kind: 'tenant', slug: 'myschool' }],
    ['a.b.sessional.app', { kind: 'invalid' }],
    ['-bad.sessional.app', { kind: 'invalid' }],
    ['xn--bad.sessional.app', { kind: 'invalid' }],
    ['ab.sessional.app', { kind: 'invalid' }],
    ['mun.school.edu', { kind: 'custom', host: 'mun.school.edu' }],
    ['evilsessional.app', { kind: 'custom', host: 'evilsessional.app' }],
    ['sessional.app.evil.com', { kind: 'custom', host: 'sessional.app.evil.com' }],
    ['sessional-git-main.vercel.app', { kind: 'marketing' }],
    ['127.0.0.1:3000', { kind: 'marketing' }],
    ['', { kind: 'invalid' }],
    ['bad host', { kind: 'invalid' }],
    ['a/b.sessional.app', { kind: 'invalid' }],
  ])('%s', (host, expected) => expect(classifyHost(host, ROOT)).toEqual(expected));

  it('works with a local root that has a port', () => {
    expect(classifyHost('alpha.localhost:3000', 'localhost:3000')).toEqual({ kind: 'tenant', slug: 'alpha' });
    expect(classifyHost('localhost:3000', 'localhost:3000')).toEqual({ kind: 'marketing' });
  });
});

describe('decideRoute', () => {
  const prod = { rootDomain: ROOT, allowTenantPaths: false };
  const preview = { rootDomain: ROOT, allowTenantPaths: true };

  it('serves marketing pages as they are', () => {
    expect(decideRoute('sessional.app', '/', prod)).toEqual({ action: 'next' });
    expect(decideRoute('www.sessional.app', '/pricing', prod)).toEqual({ action: 'next' });
  });
  it('maps a tenant host onto its internal path', () => {
    expect(decideRoute('alpha.sessional.app', '/', prod)).toEqual({ action: 'rewrite', path: '/t/alpha' });
    expect(decideRoute('alpha.sessional.app', '/committees/1', prod)).toEqual({ action: 'rewrite', path: '/t/alpha/committees/1' });
  });
  it('maps a custom domain onto a host key', () => {
    expect(decideRoute('mun.school.edu', '/login', prod)).toEqual({ action: 'rewrite', path: '/t/~mun.school.edu/login' });
  });
  it('cannot be steered to another tenant through the path', () => {
    // Stays inside alpha: /t/alpha/t/beta does not exist.
    expect(decideRoute('alpha.sessional.app', '/t/beta', prod)).toEqual({ action: 'rewrite', path: '/t/alpha/t/beta' });
    expect(decideRoute('mun.school.edu', '/t/beta', prod)).toEqual({ action: 'rewrite', path: '/t/~mun.school.edu/t/beta' });
  });
  it('hides the internal path in production', () => {
    expect(decideRoute('sessional.app', '/t/alpha', prod)).toEqual({ action: 'not-found' });
    expect(decideRoute('sessional.app', '/t', prod)).toEqual({ action: 'not-found' });
  });
  it('allows the internal path on previews, for slugs only', () => {
    expect(decideRoute('sessional-git-x.vercel.app', '/t/alpha/login', preview)).toEqual({ action: 'next', basePath: '/t/alpha' });
    expect(decideRoute('sessional-git-x.vercel.app', '/t/~mun.school.edu', preview)).toEqual({ action: 'not-found' });
    expect(decideRoute('sessional-git-x.vercel.app', '/t/%7Emun.school.edu', preview)).toEqual({ action: 'not-found' });
  });
  it('answers not-found for platform areas (until built) and invalid hosts', () => {
    expect(decideRoute('admin.sessional.app', '/', prod)).toEqual({ action: 'not-found' });
    expect(decideRoute('a.b.sessional.app', '/', prod)).toEqual({ action: 'not-found' });
    expect(decideRoute(null, '/', prod)).toEqual({ action: 'not-found' });
  });
});

describe('parseTenantKey', () => {
  it.each([
    ['alpha', { slug: 'alpha' }],
    ['~mun.school.edu', { host: 'mun.school.edu' }],
    ['%7Emun.school.edu', { host: 'mun.school.edu' }],
    ['Alpha', null],
    ['~nodot', null],
    ['~bad host.com', null],
    ['a', null],
  ])('%s', (key, expected) => expect(parseTenantKey(key)).toEqual(expected));
});
