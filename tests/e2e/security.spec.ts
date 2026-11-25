import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

// Phase 17 security review, as checks on the built app: headers on every kind of page, no secret
// in anything sent to browsers, session cookies out of reach of scripts, and no personal data in
// addresses. The rest of the review is in docs/SECURITY.md and tests/db/security.test.ts.

const PORT = 3100;
const at = (host: string, path = '/') => `http://${host}:${PORT}${path}`;

test('every kind of page sends the security headers', async ({ page }) => {
  for (const url of [at('localhost'), at('alpha.localhost', '/login'), at('admin.localhost', '/login'), at('localhost', '/gallery')]) {
    const res = await page.goto(url);
    const h = res!.headers();
    expect(h['content-security-policy'], url).toContain("frame-ancestors 'self'");
    expect(h['content-security-policy'], url).toContain("object-src 'none'");
    expect(h['x-content-type-options'], url).toBe('nosniff');
    expect(h['referrer-policy'], url).toBe('strict-origin-when-cross-origin');
    expect(h['permissions-policy'], url).toContain('camera=()');
    expect(h['x-powered-by'], url).toBeUndefined();
  }
});

test('nothing sent to browsers contains a server secret', () => {
  const secrets = ['test-service-role-key', 'sk_test_mock', 'whsec_test', 're_test_mock', 'vercel_test_mock', 'cron-test-secret', 'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_SECRET_KEY'];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(js|css|html|json|txt)$/.test(name)) files.push(path);
    }
  };
  walk('.next/static');
  expect(files.length).toBeGreaterThan(10);
  const leaks = files.flatMap((f) => {
    const text = readFileSync(f, 'utf8');
    return secrets.filter((s) => text.includes(s)).map((s) => `${s} in ${f}`);
  });
  expect(leaks).toEqual([]);
});

test('the session cookies can’t be read by scripts and are not sent by other sites', async ({ page, context }) => {
  await page.goto(at('alpha.localhost', '/login'));
  await page.getByLabel('Email').fill('owner@alpha.test');
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login'));
  const cookies = await context.cookies(at('alpha.localhost'));
  const session = cookies.filter((c) => /^s(b|_)/.test(c.name) && !['s_display', 's_lang'].includes(c.name));
  expect(session.length).toBeGreaterThan(0);
  for (const c of session) {
    expect(c.httpOnly, c.name).toBe(true);
    expect(c.sameSite, c.name).toBe('Lax');
  }
  expect(await page.evaluate(() => document.cookie)).not.toMatch(/access|refresh|token/i);
  // No address the person visits carries their email.
  expect(page.url()).not.toContain('@');
});

test('a sign-in failure says the same thing whether or not the account exists', async ({ page }) => {
  const message = async (email: string) => {
    await page.goto(at('alpha.localhost', '/login'));
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('wrong-password-1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    return page.getByRole('alert').first().innerText();
  };
  expect(await message('owner@alpha.test')).toBe(await message('nobody-here@alpha.test'));
});
