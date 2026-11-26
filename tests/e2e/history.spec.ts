import { expect, test, type Page } from '@playwright/test';

// Phase 10, part 1: several conferences. Last year's conference is cloned in one action and
// becomes the current one; past years stay readable; a full export re-imports into an empty school
// with the same counts.
test.describe.configure({ mode: 'serial' });

const PORT = 3100;
const at = (school: string, path = '/') => `http://${school}.localhost:${PORT}${path}`;

async function signIn(page: Page, school: string, email: string) {
  await page.goto(at(school, '/login'));
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}

let exported = '';

test('last year is cloned in one action and becomes the current conference', async ({ page }) => {
  await signIn(page, 'history', 'owner@history.test');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'High Command' }).click();
  await page.getByRole('navigation', { name: 'Administration' }).getByRole('link', { name: 'Conferences' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Conferences');
  // The next year's name is suggested from this one.
  await expect(page.getByLabel('New conference name')).toHaveValue('MUN 2027');
  await page.getByRole('button', { name: 'Create conference' }).click();
  await expect(page.getByText('Conference created.')).toBeVisible();

  const rows = page.getByRole('table', { name: 'All conferences' }).getByRole('row');
  await expect(rows.nth(1)).toContainText('MUN 2027');
  await expect(rows.nth(1)).toContainText('Current');
  await expect(rows.nth(2)).toContainText('MUN 2026');
  await expect(rows.nth(2)).toContainText('Archived');
  // The new year has the same committees and delegations, and nothing that happened last year.
  const cells = rows.nth(1).getByRole('cell');
  for (const [i, n] of [[2, '1'], [3, '2'], [4, '0'], [5, '0'], [6, '0']] as const) await expect(cells.nth(i)).toHaveText(n);
  // The home page shows the new year.
  await page.goto(at('history'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('MUN 2027');
});

test('a past year stays readable', async ({ page }) => {
  await signIn(page, 'history', 'owner@history.test');
  await page.goto(at('history', '/conferences'));
  await page.getByRole('link', { name: 'MUN 2026' }).click();
  await expect(page.getByText('This conference is archived: you are looking at a past year.')).toBeVisible();
  const table = page.getByRole('table', { name: 'Committees' });
  await expect(table.getByRole('row', { name: /Human Rights Council/ })).toContainText('1 of 1 passed');
});

test('a chair neither manages conferences nor downloads the school', async ({ page }) => {
  await signIn(page, 'history', 'chair@history.test');
  await page.goto(at('history', '/conferences'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('You do not have access to this page');
  await page.goto(at('history', '/owner/data'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('You do not have access to this page');
  const res = await page.evaluate(async () => (await fetch('/owner/export?format=json')).status);
  expect(res).toBe(403);
});

test('the school downloads everything as JSON, CSV and PDF', async ({ page }) => {
  await signIn(page, 'history', 'owner@history.test');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Owner' }).click();
  await page.getByRole('navigation', { name: 'Owner menu' }).getByRole('link', { name: 'Export & import' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Export and import');
  const counts = page.getByRole('list', { name: 'What the school holds' });
  await expect(counts.getByRole('listitem').filter({ hasText: /^Conferences/ })).toContainText('2');
  // An existing school cannot import over itself.
  await expect(page.getByText(/already has conferences, so an export cannot be imported here/)).toBeVisible();

  const get = (format: string) =>
    page.evaluate(async (f) => {
      const r = await fetch(`/owner/export?format=${f}`);
      const bytes = new Uint8Array(await r.arrayBuffer());
      return { status: r.status, type: r.headers.get('content-type'), disposition: r.headers.get('content-disposition'), head: String.fromCharCode(...bytes.slice(0, 4)), text: f === 'json' ? new TextDecoder().decode(bytes) : '' };
    }, format);
  const json = await get('json');
  expect(json.status).toBe(200);
  expect(json.disposition).toMatch(/attachment; filename="history-export-\d{4}-\d{2}-\d{2}\.json"/);
  const data = JSON.parse(json.text);
  expect(data.format).toBe('sessional-export');
  expect([data.conferences.length, data.committees.length, data.delegates.length, data.votes.length, data.grades.length]).toEqual([2, 2, 4, 1, 1]);
  // Who graded is not part of an export.
  expect(json.text).not.toContain('graded_by');
  exported = json.text;
  expect((await get('csv')).head).toBe('PK\u0003\u0004');
  expect((await get('pdf')).head).toBe('%PDF');
});

test('the export re-imports into an empty school with the same counts', async ({ page }) => {
  await signIn(page, 'fresh', 'owner@fresh.test');
  await page.goto(at('fresh', '/owner/data'));
  await page.getByLabel('Export file (.json)').setInputFiles({ name: 'history.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
  await page.getByRole('button', { name: 'Import' }).click();
  const done = page.getByRole('status');
  await expect(done).toContainText('Imported. The school now holds:');
  for (const [name, n] of [['Conferences', 2], ['Committees', 2], ['Delegations', 4], ['Sessions', 1], ['Votes', 1], ['Grades', 1]] as const) {
    await expect(done.getByRole('listitem').filter({ hasText: new RegExp(`^${name}:`) })).toContainText(String(n));
  }
  // Imported once; a second import is refused.
  await page.reload();
  await expect(page.getByText(/already has conferences, so an export cannot be imported here/)).toBeVisible();
  await page.goto(at('fresh', '/conferences'));
  await expect(page.getByRole('table', { name: 'All conferences' }).getByRole('row').nth(1)).toContainText('MUN 2027');
});

test('a file that is not an export is refused, and nothing changes', async ({ page }) => {
  await signIn(page, 'history', 'owner@history.test');
  const res = await page.evaluate(async () => {
    const r = await fetch('/owner/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"format":"other"}' });
    return { status: r.status, body: await r.json() };
  });
  expect(res).toEqual({ status: 400, body: { error: 'not_export' } });
});
