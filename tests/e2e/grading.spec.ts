import { expect, test, type Page } from '@playwright/test';

// Grading and awards: a chair grades from the console, the committee's Grades tab totals it,
// another committee's chair cannot see it, and the school downloads its gradebook.
test.describe.configure({ mode: 'serial' });

const PORT = 3100;
const GA = '00000000-0000-4000-9200-000000000001';
const ECOSOC = '00000000-0000-4000-9200-000000000002';
const at = (path = '/') => `http://grades.localhost:${PORT}${path}`;

async function signIn(page: Page, email: string) {
  await page.goto(at('/login'));
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}
// Downloads through the page, so the request carries the person's session cookie.
const download = (page: Page, path: string) =>
  page.evaluate(async (url) => {
    const r = await fetch(url);
    return { status: r.status, type: r.headers.get('content-type') ?? '', disposition: r.headers.get('content-disposition') ?? '', text: r.status === 200 ? await r.text() : '' };
  }, path);

test('a chair grades delegates from the console', async ({ page }) => {
  await signIn(page, 'chair@grades.test');
  await page.goto(at(`/committees/${GA}/console`));
  await page.getByRole('button', { name: 'Open session 1' }).click();
  await page.getByRole('tab', { name: 'Grading' }).click();
  const panel = page.locator('section', { has: page.locator('#grading-title') });
  const who = panel.getByRole('group', { name: 'Delegate' });

  await who.getByRole('button', { name: /Brazil/ }).click();
  await panel.getByRole('tab', { name: 'Speech' }).click();
  await panel.getByLabel('Note (optional)').fill('Strong opening');
  await panel.getByRole('button', { name: 'Excellent, 5 points, to Brazil' }).click();
  await expect(page.getByText('Excellent for Brazil.')).toBeVisible();

  await who.getByRole('button', { name: /France/ }).click();
  await panel.getByRole('button', { name: 'Good, 4 points, to France' }).click();
  await expect(page.getByText('Good for France.')).toBeVisible();
  await panel.getByRole('tab', { name: 'Question' }).click();
  await who.getByRole('button', { name: /Kenya/ }).click();
  await panel.getByRole('button', { name: 'Relevant, 2 points, to Kenya' }).click();
  await expect(page.getByText('Relevant for Kenya.')).toBeVisible();

  const leaders = page.getByRole('list', { name: 'Leaders' });
  await expect(leaders.getByRole('listitem').first()).toContainText('Brazil');
});

test('the Grades tab totals, suggests awards and keeps the log', async ({ page }) => {
  await signIn(page, 'chair@grades.test');
  await page.goto(at(`/committees/${GA}?tab=grades`));
  const standings = page.getByRole('table', { name: 'Standings' });
  await expect(standings.getByRole('row').nth(1)).toContainText('Brazil');
  await expect(standings.getByRole('row').nth(1)).toContainText('5');
  await expect(standings.getByRole('row').nth(2)).toContainText('France');

  // The best delegate follows the standings; the chair decides.
  await expect(page.getByText('Suggested: Brazil')).toBeVisible();
  await page.getByLabel('Best Delegate', { exact: true }).selectOption({ label: 'Brazil' });
  await page.locator('form', { has: page.getByLabel('Best Delegate', { exact: true }) }).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Awards saved.')).toBeVisible();
  await expect(standings.getByRole('row').nth(1)).toContainText('Best Delegate');

  // A grade given by mistake comes out of the log, and out of the totals.
  const log = page.getByRole('table', { name: 'Grading log' });
  await expect(log.getByText('Strong opening')).toBeVisible();
  await log.getByRole('button', { name: 'Remove grade for Kenya' }).click();
  await log.getByRole('button', { name: 'Yes, remove' }).click();
  await expect(page.getByText('Grade removed.')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Grading log' }).getByRole('row')).toHaveCount(3);
});

test("another committee's chair cannot read these grades", async ({ page }) => {
  await signIn(page, 'chair2@grades.test');
  await page.goto(at(`/committees/${GA}`));
  await expect(page.getByRole('link', { name: 'Grades' })).toHaveCount(0);
  await page.goto(at(`/committees/${GA}?tab=grades`));
  await expect(page.getByRole('table', { name: 'Standings' })).toHaveCount(0);
  expect((await download(page, `/grades/export?committee=${GA}&format=csv`)).status).toBe(404);
  // Their own committee works, and holds nothing from the other one.
  const own = await download(page, `/grades/export?committee=${ECOSOC}&format=csv`);
  expect(own.status).toBe(200);
  expect(own.text).not.toContain('Brazil,5');
  // The school's gradebook is for those who see every committee.
  await page.goto(at('/grades'));
  await expect(page.getByRole('heading', { name: 'You do not have access to this page' })).toBeVisible();
});

test('the school downloads its gradebook, and a saved set of columns downloads the same file again', async ({ page }) => {
  await signIn(page, 'owner@grades.test');
  await page.getByRole('link', { name: 'Gradebook' }).first().click();
  await page.waitForURL(/\/grades$/);
  const summary = page.getByRole('table', { name: 'Committees' });
  await expect(summary.getByRole('row', { name: /General Assembly/ })).toContainText('Brazil');
  await expect(summary.getByRole('row', { name: /Economic Council/ })).toContainText('0');

  const all = await download(page, '/grades/export?committee=all&format=csv');
  expect(all.status).toBe(200);
  expect(all.type).toContain('text/csv');
  expect(all.disposition).toMatch(/attachment; filename="gradebook-\d{4}-\d{2}-\d{2}\.csv"/);
  const lines = all.text.replace(/^﻿/, '').split('\r\n');
  expect(lines[0]).toBe('Committee,Rank,Delegation,Delegate,Session 1,Speech,Question,Moderated caucus,Unmoderated caucus,Papers,Explanation of vote,Total,Grade,Awards');
  expect(lines.find((l) => l.startsWith('GA,1,Brazil'))).toBe('GA,1,Brazil,Bea Student,5,5,0,0,0,0,0,5,5,Best Delegate');

  // A set with fewer columns, renamed, in another order.
  await page.getByText('New set of columns').click();
  const form = page.getByRole('form', { name: 'New set of columns' });
  await form.getByLabel('Name').fill('Certificates');
  await form.getByLabel('Usual format').selectOption('csv');
  for (const name of ['Rank', 'Session 1', 'Speech', 'Question', 'Moderated caucus', 'Unmoderated caucus', 'Papers', 'Explanation of vote', 'Grade', 'Awards']) {
    await form.getByRole('button', { name: `Remove column: ${name}`, exact: true }).click();
  }
  await form.getByLabel('Heading: Delegate').fill('Student');
  await form.getByRole('button', { name: 'Move up: Delegate' }).click();
  await form.getByLabel('Add a column').selectOption({ label: 'Committee' });
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await form.getByRole('button', { name: 'Save columns' }).click();
  await expect(page.getByText('Columns saved.')).toBeVisible();

  const link = page.getByRole('link', { name: 'Download with “Certificates”' });
  const href = (await link.getAttribute('href'))!.replace(/^https?:\/\/[^/]+/, '');
  const first = await download(page, href);
  const again = await download(page, href);
  expect(first.status).toBe(200);
  expect(again.text).toBe(first.text);
  expect(first.text.replace(/^﻿/, '').split('\r\n')[0]).toBe('Student,Delegation,Total,Committee');
  expect(first.text).toContain('Bea Student,Brazil,5,GA');
});

test('the school changes its grading rules; totals follow, grades keep their points', async ({ page }) => {
  await signIn(page, 'owner@grades.test');
  await page.goto(at('/settings?section=grading'));
  await page.getByRole('link', { name: 'Edit grading and awards' }).click();
  await page.waitForURL(/\/settings\/grading$/);
  await page.locator('summary', { hasText: /^Categories/ }).click();
  const speech = page.getByRole('list', { name: 'Categories' }).getByRole('listitem').first();
  await speech.getByLabel('Weight').fill('2');
  await page.getByRole('button', { name: 'Save and publish' }).click();
  await page.waitForURL(/done=published/);
  await expect(page.getByText('Published. It is live now.')).toBeVisible();

  // Grades are snapshots: Brazil's speech still counts 5 points at weight 1.
  await page.goto(at(`/committees/${GA}?tab=grades`));
  await expect(page.getByRole('table', { name: 'Standings' }).getByRole('row').nth(1)).toContainText('5');
  await page.goto(at('/settings/grading'));
  await page.locator('summary', { hasText: /^Categories/ }).click();
  await expect(page.getByRole('list', { name: 'Categories' }).getByRole('listitem').first().getByLabel('Weight')).toHaveValue('2');
});
