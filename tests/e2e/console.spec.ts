import { expect, test, type Page } from '@playwright/test';
import { choose, openSection, saveAndPublish } from './support/settings';

// One committee run through a session, step by step, so these run in order.
test.describe.configure({ mode: 'serial' });

const PORT = 3100;
const MOCK = 'http://localhost:3199';
const COMMITTEE = '00000000-0000-4000-9000-000000000001';
const at = (path = '/') => `http://console.localhost:${PORT}${path}`;

async function signIn(page: Page, email: string) {
  await page.goto(at('/login'));
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}

const row = (page: Page, label: string) => page.getByRole('group', { name: label, exact: true });
const mark = (page: Page, label: string, state: string) => row(page, label).getByRole('button', { name: state, exact: true }).click();
const saved = (page: Page) => expect(page.getByText('All changes saved.')).toBeVisible();

test('a chair opens a session and takes the roll call', async ({ page }) => {
  await signIn(page, 'chair@console.test');
  await page.goto(at(`/committees/${COMMITTEE}`));
  await page.getByRole('link', { name: /Open the console/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Console: Disarmament');
  await expect(page.getByText('No session is open.')).toBeVisible();
  await expect(page.getByText('No sessions yet.')).toBeVisible();

  await page.getByRole('button', { name: 'Open session 1' }).click();
  await expect(page.getByText(/^Session 1, open since/)).toBeVisible();
  await expect(page.getByText(/In progress\. Mark each Delegate as they answer\. 5 have not answered yet\./)).toBeVisible();
  await expect(page.getByText('0 of 5 present')).toBeVisible();

  await mark(page, 'Brazil', 'Present');
  await mark(page, 'China', 'Present and voting');
  await mark(page, 'France', 'Absent');
  await saved(page);
  await expect(page.getByText('2 of 5 present')).toBeVisible();
  await expect(page.getByText('Debate needs 2: reached')).toBeVisible();
  await expect(page.getByText('Voting needs 3: not reached')).toBeVisible();
  await expect(row(page, 'China').getByRole('button', { name: 'Present and voting' })).toHaveAttribute('aria-pressed', 'true');

  // Saved on the server, not only on screen.
  await page.reload();
  await expect(row(page, 'Brazil').getByRole('button', { name: 'Present', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('2 of 5 present')).toBeVisible();
});

test('a second chair sees the first chair\'s changes without reloading', async ({ page, browser }) => {
  await signIn(page, 'chair@console.test');
  await page.goto(at(`/committees/${COMMITTEE}/console`));
  const other = await browser.newPage();
  await signIn(other, 'chair2@console.test');
  await other.goto(at(`/committees/${COMMITTEE}/console`));
  await expect(other.getByText('2 of 5 present')).toBeVisible();

  await mark(page, 'Kenya', 'Present');
  await saved(page);
  await expect(other.getByText('3 of 5 present')).toBeVisible({ timeout: 12_000 });
  await expect(row(other, 'Kenya').getByRole('button', { name: 'Present', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await other.close();
});

test('a change whose answer is lost is sent again and applied once', async ({ page, request }) => {
  await signIn(page, 'chair@console.test');
  await page.goto(at(`/committees/${COMMITTEE}/console`));
  await request.post(`${MOCK}/__test/drop-commits`, { data: { count: 1 } });
  await mark(page, 'Mexico', 'Present');
  // Shown as waiting, never as saved, until the server confirms.
  await expect(page.getByText(/Saving 1 change…|No connection\. 1 change is waiting/)).toBeVisible();
  await expect(page.getByRole('listitem').filter({ has: row(page, 'Mexico') }).getByText('Saving…')).toBeVisible();
  // The server waits five seconds for the lost answer, then the console sends it again.
  await expect(page.getByText('All changes saved.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('4 of 5 present')).toBeVisible();
  await page.reload();
  await expect(page.getByText('4 of 5 present')).toBeVisible();
  // Tapping the same answer again clears it: had the first command been applied twice, it would
  // have stayed as it was.
  await mark(page, 'Mexico', 'Present');
  await saved(page);
  await expect(page.getByText('3 of 5 present')).toBeVisible();
});

test('the roll call is finished and recorded, then the session is closed', async ({ page }) => {
  await signIn(page, 'chair@console.test');
  await page.goto(at(`/committees/${COMMITTEE}/console`));
  await page.getByRole('button', { name: 'Mark everyone not answered as Absent' }).click();
  await saved(page);
  await expect(page.getByText(/Everyone has answered\./)).toBeVisible();
  await page.getByRole('button', { name: 'Finish roll call' }).click();
  await saved(page);
  await expect(page.getByText(/^Taken at/)).toBeVisible();

  await page.getByRole('button', { name: 'Close session' }).click();
  await page.getByRole('button', { name: 'Keep it open' }).click();
  await expect(page.getByText(/^Session 1, open since/)).toBeVisible();
  await page.getByRole('button', { name: 'Close session' }).click();
  await page.getByRole('button', { name: 'Yes, close session 1' }).click();
  await expect(page.getByText('No session is open.')).toBeVisible();
  await saved(page);

  await page.reload();
  const history = page.getByRole('list', { name: 'Sessions' });
  await expect(history).toContainText(/Session 1: .+ to /);
  await expect(history).toContainText(/Roll call at .+: Present 2 · Present and voting 1 · Absent 2/);
  await expect(page.getByRole('button', { name: 'Open session 2' })).toBeVisible();
});

test('a new rule set applies from the next session', async ({ page }) => {
  await signIn(page, 'owner@console.test');
  const rules = await openSection(page, 'console', 'protocol');
  await choose(rules, 'Starting point', 'THIMUN-style');
  await saveAndPublish(rules);

  await page.goto(at(`/committees/${COMMITTEE}/console`));
  await page.getByRole('button', { name: 'Open session 2' }).click();
  await expect(page.getByText(/^Session 2, open since/)).toBeVisible();
  await expect(row(page, 'Brazil').getByRole('button')).toHaveCount(2);
  await expect(row(page, 'Brazil').getByRole('button', { name: 'Present and voting' })).toHaveCount(0);
  await expect(page.getByText('Voting needs 3: not reached')).toBeVisible();
});

test('people who do not run the committee cannot open its console', async ({ page }) => {
  await signIn(page, 'hc@alpha.test');
  await page.goto(at(`/committees/${COMMITTEE}/console`));
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Console: Disarmament');
});
