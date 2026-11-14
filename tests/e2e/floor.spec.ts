import { expect, test, type Page } from '@playwright/test';

// One committee's floor, step by step: speakers, timers, caucuses. Runs in order.
test.describe.configure({ mode: 'serial' });

const PORT = 3100;
const COMMITTEE = '00000000-0000-4000-9000-000000000002';
const at = (path = '/') => `http://floor.localhost:${PORT}${path}`;
const CONSOLE = `/committees/${COMMITTEE}/console`;

async function signIn(page: Page, email: string) {
  await page.goto(at('/login'));
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
  await page.goto(at(CONSOLE));
}

const saved = (page: Page) => expect(page.getByText('All changes saved.')).toBeVisible();
const floor = (page: Page) => page.locator('section', { has: page.locator('#floor-title') });
const queue = (page: Page, name = 'General speakers list') => floor(page).getByRole('list', { name });
const add = async (page: Page, label: string) => {
  await floor(page).getByRole('group', { name: 'Add to the list' }).getByRole('button', { name: `+ ${label}` }).click();
  await saved(page);
};
const seconds = (text: string) => {
  const [m, s] = text.replace('-', '').split(':').map(Number);
  return m! * 60 + s!;
};

test('the speakers list takes present delegates only, and can be reordered', async ({ page }) => {
  await signIn(page, 'chair@floor.test');
  await page.getByRole('button', { name: 'Open session 1' }).click();
  await page.getByRole('group', { name: 'Mexico', exact: true }).getByRole('button', { name: 'Absent' }).click();
  await page.getByRole('button', { name: /Mark everyone not answered as Absent/ }).click();
  await saved(page);
  // Nobody is present yet, so nobody can be added.
  await expect(floor(page).getByText(/Nobody else can be added/)).toBeVisible();
  for (const d of ['Brazil', 'China', 'France', 'Kenya']) await page.getByRole('group', { name: d, exact: true }).getByRole('button', { name: 'Present', exact: true }).click();
  await saved(page);

  const chips = floor(page).getByRole('group', { name: 'Add to the list' });
  await expect(chips.getByRole('button')).toHaveText(['+ Brazil', '+ China', '+ France', '+ Kenya']);
  await add(page, 'Brazil');
  await add(page, 'China');
  await add(page, 'France');
  await expect(chips.getByRole('button')).toHaveText(['+ Kenya']);
  await floor(page).getByRole('button', { name: 'Move France up' }).click();
  await floor(page).getByRole('button', { name: 'Take China off the list' }).click();
  await saved(page);
  await expect(queue(page).getByRole('listitem')).toHaveText([/Brazil/, /France/]);
  await page.reload();
  await expect(queue(page).getByRole('listitem')).toHaveText([/Brazil/, /France/]);
});

test('a speaker gets the floor, the timer runs on the server clock and survives a reload', async ({ page, browser }) => {
  await signIn(page, 'chair@floor.test');
  await floor(page).getByRole('button', { name: '0:30' }).click();
  await floor(page).getByRole('button', { name: 'Next speaker' }).click();
  await saved(page);
  await expect(floor(page).getByText('Has the floor')).toBeVisible();
  await expect(floor(page).getByText('Brazil', { exact: true })).toBeVisible();
  const timer = floor(page).getByRole('timer', { name: 'Time left', exact: true });
  await expect(timer).toHaveText('0:30');
  await expect(floor(page).getByText('Ready to start')).toBeVisible();

  await floor(page).getByRole('button', { name: 'Start', exact: true }).click();
  await saved(page);
  await expect(floor(page).getByText('Running')).toBeVisible();
  await expect.poll(async () => seconds(await timer.innerText()), { timeout: 5000 }).toBeLessThan(29);

  // Another chair's screen shows the same speaker and nearly the same time.
  const other = await browser.newPage();
  await signIn(other, 'chair2@floor.test');
  const theirs = floor(other).getByRole('timer', { name: 'Time left', exact: true });
  const mine = seconds(await timer.innerText());
  expect(Math.abs(seconds(await theirs.innerText()) - mine)).toBeLessThanOrEqual(2);
  await other.close();

  await floor(page).getByRole('button', { name: 'Pause' }).click();
  await saved(page);
  await expect(floor(page).getByText('Paused')).toBeVisible();
  const paused = await timer.innerText();
  await page.waitForTimeout(1500);
  await expect(timer).toHaveText(paused);
  await page.reload();
  await expect(floor(page).getByRole('timer', { name: 'Time left', exact: true })).toHaveText(paused);
});

test('the next speaker ends the speech and records it', async ({ page }) => {
  await signIn(page, 'chair@floor.test');
  await floor(page).getByRole('button', { name: 'Next speaker' }).click();
  await saved(page);
  await expect(floor(page).getByText('France', { exact: true })).toBeVisible();
  await expect(queue(page).getByRole('listitem')).toHaveCount(0);
  await expect(floor(page).getByRole('button', { name: 'Next speaker' })).toBeDisabled();
  await floor(page).getByRole('button', { name: 'End speech' }).click();
  await saved(page);
  await expect(floor(page).getByText('Nobody yet. Call the next speaker.')).toBeVisible();
});

test('a moderated caucus has its own list and time, can be extended once and ended', async ({ page }) => {
  await signIn(page, 'chair@floor.test');
  await floor(page).getByText('Start a caucus').click();
  await floor(page).getByRole('button', { name: 'Moderated caucus', exact: true }).click();
  await floor(page).getByLabel('Minutes (up to 20)').fill('5');
  await floor(page).getByLabel('Speaking time, in seconds').fill('45');
  await floor(page).getByLabel('Topic').fill('Funding');
  await floor(page).getByRole('button', { name: 'Start caucus' }).click();
  await saved(page);
  await expect(page.locator('#floor-title')).toHaveText('Moderated caucus: Funding');
  const left = floor(page).getByRole('timer', { name: 'Caucus time left' });
  await expect.poll(async () => seconds(await left.innerText())).toBeGreaterThan(290);

  await add(page, 'Kenya');
  await expect(queue(page, 'Speakers in this caucus').getByRole('listitem')).toHaveText([/Kenya/]);
  await floor(page).getByRole('button', { name: 'Next speaker' }).click();
  await saved(page);
  await expect(floor(page).getByRole('timer', { name: 'Time left', exact: true })).toHaveText('0:45');

  await floor(page).getByLabel('Extend by (minutes)').fill('2');
  await floor(page).getByRole('button', { name: 'Extend', exact: true }).click();
  await saved(page);
  await expect.poll(async () => seconds(await left.innerText())).toBeGreaterThan(410);
  await expect(floor(page).getByRole('button', { name: 'Extend', exact: true })).toHaveCount(0);

  await floor(page).getByRole('button', { name: 'End caucus' }).click();
  await floor(page).getByRole('button', { name: 'Yes, end the caucus' }).click();
  await saved(page);
  await expect(page.locator('#floor-title')).toHaveText('Formal debate');
  await expect(queue(page).getByRole('listitem')).toHaveCount(0);
});

test('an unmoderated caucus has only a clock, and pauses', async ({ page }) => {
  await signIn(page, 'chair@floor.test');
  await floor(page).getByText('Start a caucus').click();
  await floor(page).getByRole('button', { name: 'Unmoderated caucus' }).click();
  await floor(page).getByRole('button', { name: 'Start caucus' }).click();
  await saved(page);
  await expect(page.locator('#floor-title')).toHaveText('Unmoderated caucus');
  await expect(floor(page).getByText(/no speakers list/)).toBeVisible();
  await floor(page).getByRole('button', { name: 'Pause caucus' }).click();
  await saved(page);
  await expect(floor(page).getByRole('button', { name: 'Resume caucus' })).toBeVisible();
  await floor(page).getByRole('button', { name: 'End caucus' }).click();
  await floor(page).getByRole('button', { name: 'Yes, end the caucus' }).click();
  await saved(page);
});

test('closing the session keeps a record of the speeches', async ({ page }) => {
  await signIn(page, 'chair@floor.test');
  await page.getByRole('button', { name: 'Close session' }).click();
  await page.getByRole('button', { name: 'Yes, close session 1' }).click();
  await saved(page);
  await page.reload();
  // Brazil's speech (a few seconds) was recorded; France and Kenya never started speaking.
  await expect(page.getByRole('list', { name: 'Sessions' })).toContainText(/1 speech, 0:0\d in total/);
});
