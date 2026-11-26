import { expect, test } from '@playwright/test';

// Phase 17: the public status page and the health endpoint for uptime monitors.
const ROOT = 'http://localhost:3100';

test('the status page says whether Sessional works, part by part, in both languages', async ({ page }) => {
  await page.goto(`${ROOT}/`);
  await page.getByRole('contentinfo').getByRole('link', { name: 'Status' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Status');
  await expect(page.getByRole('status')).toHaveText('Everything is working.');
  const parts = page.getByRole('list', { name: 'Parts of Sessional' }).getByRole('listitem');
  await expect(parts).toHaveCount(5);
  await expect(parts.filter({ hasText: 'Conferences and data' })).toContainText('Working');
  await expect(parts.filter({ hasText: 'Sign-in' })).toContainText('Working');
  await expect(parts.filter({ hasText: 'Payments' })).toContainText('Working');
  await page.goto(`${ROOT}/status?lang=es`);
  await expect(page.getByRole('status')).toHaveText('Todo funciona.');
});

test('the health endpoint answers monitors with no personal data', async ({ request }) => {
  const res = await request.get(`${ROOT}/api/health`);
  expect(res.status()).toBe(200);
  expect(res.headers()['cache-control']).toBe('no-store');
  const body = await res.json();
  expect(body.status).toBe('ok');
  expect(body.checks.database.level).toBe('ok');
  expect(Object.keys(body.checks)).toEqual(['app', 'database', 'signin', 'email', 'payments']);
  expect(JSON.stringify(body)).not.toMatch(/@|School|key/i);
});
