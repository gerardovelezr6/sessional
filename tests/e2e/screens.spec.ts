import { expect, test, type Browser, type Page } from '@playwright/test';

// Projection screens: a device shows a code, a chair pairs it, and it follows the committee live.
test.describe.configure({ mode: 'serial' });

const PORT = 3100;
const MOCK = 'http://localhost:3199';
const COMMITTEE = '00000000-0000-4000-9000-000000000004';
const at = (path = '/', host = 'screens') => `http://${host}.localhost:${PORT}${path}`;

async function signIn(page: Page, email = 'chair@screens.test', host = 'screens') {
  await page.goto(at('/login', host));
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}
const saved = (page: Page) => expect(page.getByText('All changes saved.')).toBeVisible();

// One screen device for the whole file: its own browser context, so its own cookie.
let screen: Page;
let code = '';
let chair: Page;

async function newScreen(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.goto(at('/display'));
  return page;
}

test('a new screen shows a code, full window, with no menus', async ({ browser }) => {
  screen = await newScreen(browser);
  const codeEl = screen.getByLabel('Screen code');
  await expect(codeEl).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/);
  code = (await codeEl.innerText()).trim();
  await expect(screen.getByText(/enters this code in the console/)).toBeVisible();
  await expect(screen.locator('header.app-header')).toBeHidden();
  // The same device keeps its code after a reload.
  await screen.reload();
  await expect(screen.getByLabel('Screen code')).toHaveText(code);
});

test('another school cannot pair this screen, even with its code', async ({ browser }) => {
  const other = await (await browser.newContext()).newPage();
  await signIn(other, 'chair@rules.test', 'rules');
  await other.goto(at('/committees/00000000-0000-4000-9000-000000000003/console', 'rules'));
  const panel = other.locator('section', { has: other.locator('#screens-title') });
  await panel.getByLabel('Code on the screen').fill(code);
  await panel.getByRole('button', { name: 'Pair screen' }).click();
  await expect(panel.getByRole('alert')).toHaveText(/No screen shows that code/);
  await other.context().close();
});

test('the chair pairs it; the screen switches to the committee by itself', async ({ browser }) => {
  chair = await (await browser.newContext()).newPage();
  await signIn(chair);
  await chair.goto(at(`/committees/${COMMITTEE}/console`));
  const panel = chair.locator('section', { has: chair.locator('#screens-title') });
  await panel.getByLabel('Code on the screen').fill('AAAAAA');
  await panel.getByRole('button', { name: 'Pair screen' }).click();
  await expect(panel.getByRole('alert')).toHaveText(/No screen shows that code/);

  await panel.getByLabel('Code on the screen').fill(code.toLowerCase());
  await panel.getByLabel('Name').fill('Main hall');
  await panel.getByRole('button', { name: 'Pair screen' }).click();
  await expect(panel.getByRole('status')).toHaveText('Screen paired. It now shows this committee.');
  await expect(panel.getByRole('list', { name: 'Projection screens' })).toContainText('Main hall');

  await expect(screen.getByText('WHO · World Health')).toBeVisible({ timeout: 10_000 });
  await expect(screen.getByText('Pandemic preparedness')).toBeVisible();
  await expect(screen.getByText('Not in session')).toBeVisible();
});

test('the screen follows the floor live: speaker, timer, list', async () => {
  await chair.getByRole('button', { name: 'Open session 1' }).click();
  await saved(chair);
  for (const d of ['Brazil', 'China', 'France']) await chair.getByRole('group', { name: d, exact: true }).getByRole('button', { name: 'Present', exact: true }).click();
  await saved(chair);
  await chair.getByRole('tab', { name: 'Speakers & caucus' }).click();
  const floor = chair.locator('section', { has: chair.locator('#floor-title') });
  for (const d of ['Brazil', 'China']) {
    await floor.getByRole('group', { name: 'Add to the list' }).getByRole('button', { name: `+ ${d}` }).click();
    await saved(chair);
  }
  await floor.getByRole('button', { name: 'Next speaker' }).click();
  await saved(chair);
  await floor.getByRole('button', { name: 'Start', exact: true }).click();
  await saved(chair);

  await expect(screen.getByText('Session 1')).toBeVisible({ timeout: 10_000 });
  await expect(screen.getByText('3 of 4 present')).toBeVisible();
  await expect(screen.getByText('Brazil', { exact: true })).toBeVisible();
  await expect(screen.getByRole('list', { name: 'Speakers list' })).toContainText('China');
  const timer = screen.getByRole('timer', { name: 'Time left' });
  const first = await timer.innerText();
  await expect.poll(() => timer.innerText(), { timeout: 5000 }).not.toBe(first);

  // Each change was announced on the committee's channel, carrying only a revision number.
  const announced = (await (await fetch(`${MOCK}/__test/announcements`)).json()) as { topic: string; payload: Record<string, unknown> }[];
  expect(announced.length).toBeGreaterThan(0);
  for (const a of announced) {
    expect(a.topic).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(a.payload)).toEqual(['revision']);
  }
});

test('the chair changes what the screen shows', async () => {
  await chair.getByRole('tab', { name: 'Screens' }).click();
  await chair.getByLabel('Shows: Main hall').selectOption({ label: 'Timer only' });
  await expect(chair.getByText('Saved.')).toBeVisible();
  await expect(screen.getByRole('list', { name: 'Speakers list' })).toHaveCount(0, { timeout: 10_000 });
  await expect(screen.getByRole('timer', { name: 'Time left' })).toBeVisible();
});

test('a vote shows its running totals', async () => {
  await chair.getByRole('tab', { name: 'Voting' }).click();
  const vote = chair.locator('section', { has: chair.locator('#vote-title') });
  await vote.getByLabel('What is being voted on').fill('Draft resolution 1.1');
  await vote.getByRole('button', { name: 'Open the vote' }).click();
  await saved(chair);
  await vote.getByLabel('Yes').fill('2');
  await vote.getByLabel('No').fill('1');
  await vote.getByRole('button', { name: 'Save the count' }).click();
  await saved(chair);
  await expect(screen.getByRole('heading', { name: 'Draft resolution 1.1' })).toBeVisible({ timeout: 10_000 });
  await expect(screen.getByText('2', { exact: true }).first()).toBeVisible();
  await vote.getByRole('button', { name: 'Close the vote and announce the result' }).click();
  await saved(chair);
  await expect(screen.getByText(/^Passed: Draft resolution 1\.1/)).toBeVisible({ timeout: 10_000 });
});

test('nothing private reaches a screen', async () => {
  await chair.getByRole('tab', { name: 'Discipline' }).click();
  const discipline = chair.locator('section', { has: chair.locator('#discipline-title') });
  await discipline.getByLabel('Who').selectOption({ label: 'Kenya' });
  await discipline.getByLabel('Reason (short)').fill('Phones in session');
  await discipline.getByRole('button', { name: 'Give warning' }).click();
  await saved(chair);
  // What the screen itself fetches, from inside the screen's page.
  const { ok, text } = await screen.evaluate(async () => {
    const res = await fetch('/display/state', { cache: 'no-store' });
    return { ok: res.ok, text: await res.text() };
  });
  expect(ok).toBe(true);
  expect(text).toContain('Kenya');
  expect(text).not.toContain('Phones in session');
  expect(text).not.toContain('Bea Student');
  expect(text).not.toContain('warnings');
  expect(text).not.toContain('attendance');
  expect(text).not.toContain('ballots');
});

test('a screen offline for five minutes recovers by itself', async ({ browser }) => {
  // A screen whose clock the test controls.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const kiosk = await ctx.newPage();
  await kiosk.clock.install();
  // Same device as `screen`: reuse its cookie.
  await ctx.addCookies(await screen.context().cookies());
  await kiosk.goto(at('/display'));
  await expect(kiosk.getByText('WHO · World Health')).toBeVisible();

  await ctx.setOffline(true);
  await kiosk.clock.fastForward('05:00');
  await expect(kiosk.getByRole('status').filter({ hasText: 'Reconnecting…' })).toBeVisible();
  // The last picture stays on screen meanwhile.
  await expect(kiosk.getByText('WHO · World Health')).toBeVisible();

  // Something changes while it is offline.
  await chair.getByRole('tab', { name: 'Speakers & caucus' }).click();
  await chair.locator('section', { has: chair.locator('#floor-title') }).getByRole('button', { name: 'Next speaker' }).click();
  await saved(chair);

  await ctx.setOffline(false);
  await kiosk.clock.fastForward('00:31');
  await expect(kiosk.getByRole('status').filter({ hasText: 'Reconnecting…' })).toHaveCount(0, { timeout: 10_000 });
  await expect(kiosk.getByText('China', { exact: true })).toBeVisible();
  await ctx.close();
});

test('unpairing returns the screen to a new code', async () => {
  await chair.getByRole('tab', { name: 'Screens' }).click();
  await chair.getByRole('button', { name: 'Unpair: Main hall' }).click();
  await chair.getByRole('button', { name: 'Yes, unpair' }).click();
  await expect(chair.getByText('Screen unpaired. It shows a new code.')).toBeVisible();
  await expect(screen.getByLabel('Screen code')).toHaveText(/^[A-HJ-NP-Z2-9]{6}$/, { timeout: 15_000 });
  expect((await screen.getByLabel('Screen code').innerText()).trim()).not.toBe(code);
});
