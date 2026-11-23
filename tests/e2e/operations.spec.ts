import { expect, test, type Page } from '@playwright/test';

// Phase 10, parts 2 and 3: live analytics, the schedule, module toggles, year over year, reset.
test.describe.configure({ mode: 'serial' });

const PORT = 3100;
const COMMITTEE = '00000000-0000-4000-9500-000000000001';
const at = (path = '/') => `http://ops.localhost:${PORT}${path}`;

async function signIn(page: Page, email: string) {
  await page.goto(at('/login'));
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}
const pad = (n: number) => String(n).padStart(2, '0');

test('High Command sees the conference live, as counts only', async ({ page }) => {
  await signIn(page, 'owner@ops.test');
  await page.goto(at('/admin'));
  await expect(page.getByText(/^Ops MUN 2026 · updated/)).toBeVisible();
  const stats = page.getByRole('region', { name: 'Live analytics' });
  const stat = (label: string) => stats.locator('.stat').filter({ has: page.locator('.label-text', { hasText: new RegExp(`^${label}$`) }) }).locator('.stat-value');
  await expect(stat('Speeches given')).toHaveText('1');
  await expect(stat('Minutes of speeches')).toHaveText('2');
  await expect(stat('Votes held')).toHaveText('1 of 1 passed');
  const row = page.getByRole('table', { name: 'By committee' }).getByRole('row', { name: /SC/ });
  await expect(row).toContainText('Between sessions');
  await expect(row).not.toContainText('Brazil');
});

test('the schedule is planned once and shows on the schedule, home page, dashboard and console', async ({ page }) => {
  await signIn(page, 'owner@ops.test');
  await page.goto(at('/schedule'));
  // An item running now (the school's time zone is UTC here).
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 60000);
  const to = new Date(now.getTime() + 90 * 60000);
  await page.getByLabel('Title').fill('Session 2');
  await page.getByLabel('Date').fill(from.toISOString().slice(0, 10));
  await page.getByLabel('Starts').fill(`${pad(from.getUTCHours())}:${pad(from.getUTCMinutes())}`);
  await page.getByLabel('Ends').fill(to.getUTCDate() === from.getUTCDate() ? `${pad(to.getUTCHours())}:${pad(to.getUTCMinutes())}` : '23:59');
  await page.getByLabel('Place (optional)').fill('Hall B');
  await page.getByLabel('Session number (sessions only)').fill('2');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('Added to the schedule.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Now and next' })).toContainText('Session 2');
  await expect(page.getByText('Session 2', { exact: true }).last()).toBeVisible();

  await page.goto(at('/'));
  await expect(page.getByRole('heading', { name: /^Schedule/ })).toBeVisible();
  await page.goto(at('/dashboard'));
  await expect(page.getByRole('heading', { name: /^Schedule/ })).toBeVisible();
  await page.goto(at(`/committees/${COMMITTEE}/console`));
  await expect(page.getByText(/^Schedule: Session 2 until/)).toBeVisible();
});

test('a chair reads the schedule but cannot change it', async ({ page }) => {
  await signIn(page, 'chair@ops.test');
  await page.goto(at('/schedule'));
  await expect(page.getByText('Hall B', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Remove/ })).toHaveCount(0);
});

test('the Owner turns modules off; they disappear and the server refuses them', async ({ page }) => {
  await signIn(page, 'owner@ops.test');
  await page.goto(at('/settings?section=modules'));
  const modules = page.locator('section#modules');
  for (const name of ['Discipline', 'Projection screens', 'Documents', 'Schedule']) {
    await modules.getByRole('group', { name, exact: true }).getByText('Off', { exact: true }).click();
  }
  await modules.getByRole('button', { name: 'Save and publish' }).click();
  await page.waitForURL(/done=published/);

  await page.goto(at(`/committees/${COMMITTEE}/console`));
  await page.getByRole('button', { name: /Open session/ }).click();
  const tabs = page.getByRole('tablist', { name: /Parts of the console/ });
  await expect(tabs.getByRole('tab', { name: 'Discipline' })).toHaveCount(0);
  await expect(tabs.getByRole('tab', { name: 'Screens' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Open projection screen/ })).toHaveCount(0);
  await expect(page.getByText(/^Schedule:/)).toHaveCount(0);
  await page.goto(at(`/committees/${COMMITTEE}`));
  await expect(page.getByRole('link', { name: 'Documents' })).toHaveCount(0);
  for (const path of [`/committees/${COMMITTEE}/documents`, '/schedule']) {
    await page.goto(at(path));
    await expect(page.getByRole('heading', { level: 1 }), path).toHaveText('This part is turned off');
  }
  expect(await page.evaluate(async () => (await fetch('/display/state')).status)).toBe(404);
  await expect(page.getByRole('navigation', { name: 'Administration' }).getByRole('link', { name: 'Schedule' })).toHaveCount(0);

  // Back on.
  await page.goto(at('/settings?section=modules'));
  for (const name of ['Discipline', 'Projection screens', 'Documents', 'Schedule']) {
    await page.locator('section#modules').getByRole('group', { name, exact: true }).getByText('On', { exact: true }).click();
  }
  await page.locator('section#modules').getByRole('button', { name: 'Save and publish' }).click();
  await page.waitForURL(/done=published/);
});

test('years are compared side by side, and the schedule moves with a clone', async ({ page }) => {
  await signIn(page, 'owner@ops.test');
  await page.goto(at('/conferences'));
  await page.getByLabel('New conference name').fill('Ops MUN 2027');
  await page.getByRole('button', { name: 'Create conference' }).click();
  await expect(page.getByText('Conference created.')).toBeVisible();
  const yoy = page.getByRole('table', { name: 'Year over year' });
  await expect(yoy.getByRole('columnheader')).toHaveText(['Measure', 'Ops MUN 2026', 'Ops MUN 2027']);
  await expect(yoy.getByRole('row', { name: /^Speeches/ })).toContainText('1');
  await expect(yoy.getByRole('row', { name: /^Average speech/ })).toContainText('90 s');
  await expect(yoy.getByRole('row', { name: /^Votes passed/ })).toContainText('100%');
  await expect(yoy.getByRole('row', { name: /^Speeches/ }).getByLabel('less than the year before')).toBeVisible();
  // The new year's schedule is last year's, 52 weeks later.
  await page.goto(at('/schedule'));
  await expect(page.getByText('Session 2', { exact: true }).last()).toBeVisible();
});

test('only the Owner resets the school, by typing its name', async ({ page, browser }) => {
  const hc = await (await browser.newContext()).newPage();
  await signIn(hc, 'hc@ops.test');
  await hc.goto(at('/owner/reset'));
  await expect(hc.getByRole('heading', { level: 1 })).toHaveText('You do not have access to this page');
  await hc.context().close();

  await signIn(page, 'owner@ops.test');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Owner' }).click();
  await page.getByRole('navigation', { name: 'Owner settings' }).getByRole('link', { name: 'Reset' }).click();
  await expect(page.getByText(/^2 conferences, 2 committees/)).toBeVisible();
  await page.getByLabel(/Type the school’s name to confirm/).fill('ops school');
  await page.getByRole('button', { name: 'Remove every conference' }).click();
  await expect(page.getByText('The name does not match. Type it exactly as shown.')).toBeVisible();
  await page.getByLabel(/Type the school’s name to confirm/).fill('Ops School');
  await page.getByRole('button', { name: 'Remove every conference' }).click();
  await expect(page.getByText(/^Done. The school has no conferences now/)).toBeVisible();
  await expect(page.getByText('There is nothing to remove.')).toBeVisible();
});
