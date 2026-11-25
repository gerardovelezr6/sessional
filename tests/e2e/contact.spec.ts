import { expect, test, type Page } from '@playwright/test';

// The main website: the contact form (stored, rate limited, read in Admin → Inbox), the live
// committee scene, and the grouped, navigable sections.
test.describe.configure({ mode: 'serial' });

const PORT = 3100;
const admin = (path = '/') => `http://admin.localhost:${PORT}${path}`;
let address = 0;
// Each test writes from its own network address, as far as rate limiting can tell.
const fromNewAddress = (page: Page) => page.setExtraHTTPHeaders({ 'x-forwarded-for': `203.0.113.${++address + Math.floor(Math.random() * 200)}` });

async function fill(page: Page, name: string, org: string) {
  const form = page.locator('#contact form');
  await form.getByLabel('Your name').fill(name);
  await form.getByLabel('Email').fill(`${name.split(' ')[0]!.toLowerCase()}@school.test`);
  await form.getByRole('combobox', { name: 'You are', exact: true }).selectOption('staff');
  await form.getByLabel('School or organization').fill(org);
  await form.getByRole('combobox', { name: /^Country/ }).selectOption('MX');
  await form.getByLabel(/^Committees/).fill('12');
  await form.getByLabel(/^Delegates/).fill('300');
  await form.getByLabel(/^Anything else/).fill('We use THIMUN rules.');
}
// People take more than a few seconds to fill a form; the form ignores anything faster.
const humanPause = (page: Page) => page.waitForTimeout(3100);

test('the contact form explains what is missing, then files the request', async ({ page }) => {
  await fromNewAddress(page);
  await page.goto('/');
  await page.getByRole('link', { name: 'Write to us' }).click();
  await expect(page).toHaveURL(/#contact$/);
  const form = page.locator('#contact form');
  await form.getByLabel('Email').fill('not-an-email');
  await humanPause(page);
  await form.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Some fields need a second look.')).toBeVisible();
  await expect(form.getByLabel('Your name')).toBeFocused();
  await expect(form.getByLabel('Your name')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Write an email address like name@school.edu.')).toBeVisible();

  await fill(page, 'Ana Torres', 'Colegio Contacto');
  await form.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('status')).toContainText('Thanks. We have your message.');
});

test('a bot that fills the hidden field is told it worked, and nothing is stored', async ({ page }) => {
  await fromNewAddress(page);
  await page.goto('/');
  await fill(page, 'Robot Uno', 'Bot Academy');
  await page.locator('#contact-website').evaluate((el: HTMLInputElement) => (el.value = 'https://spam.test'));
  await humanPause(page);
  await page.locator('#contact form').getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('status')).toContainText('Thanks. We have your message.');
});

test('a fourth message within the hour from one address is refused with a reason', async ({ page }) => {
  await fromNewAddress(page);
  for (const n of [1, 2, 3]) {
    await page.goto('/');
    await fill(page, `Flood ${n}`, `Flood School ${n}`);
    await humanPause(page);
    await page.locator('#contact form').getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('status')).toContainText('Thanks.');
  }
  await page.goto('/');
  await fill(page, 'Flood Four', 'Flood School 4');
  await humanPause(page);
  await page.locator('#contact form').getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('several messages from your network in the last hour')).toBeVisible();
});

test('a platform admin reads requests in the inbox, marks them answered and deletes them', async ({ page }) => {
  await page.goto(admin('/login'));
  await page.getByLabel('Email').fill('root@platform.test');
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Inbox' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Inbox');
  const item = page.getByRole('listitem').filter({ hasText: 'Colegio Contacto' });
  await expect(item).toContainText('Ana Torres');
  await expect(item).toContainText('ana@school.test');
  await expect(item).toContainText('Mexico');
  await expect(item).toContainText('12 committees, 300 delegates');
  await expect(item).toContainText('We use THIMUN rules.');
  await expect(page.getByRole('listitem').filter({ hasText: 'Bot Academy' })).toHaveCount(0);
  await item.getByRole('button', { name: 'Mark answered' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Colegio Contacto' })).toContainText('Answered');
  await page.getByRole('listitem').filter({ hasText: 'Colegio Contacto' }).getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete this request for good' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Colegio Contacto' })).toHaveCount(0);
});

test('the committee runs by itself on three screens at once, and can be paused', async ({ page }) => {
  await page.goto('/');
  const console_ = page.getByRole('figure', { name: 'The chair’s console during a general debate' });
  const timer = console_.locator('.font-mono.text-4xl');
  const first = await timer.textContent();
  await expect(timer).not.toHaveText(first!, { timeout: 3000 });
  // The projector and the phone show the same clock.
  await page.locator('#screens').scrollIntoViewIfNeeded();
  const projector = page.getByRole('figure', { name: 'The projector screen in the committee room' });
  const phone = page.getByRole('figure', { name: 'A delegate’s phone' });
  await console_.getByRole('button', { name: 'Pause' }).click();
  await expect(console_.getByRole('button', { name: 'Play' })).toHaveAttribute('aria-pressed', 'true');
  const stopped = await timer.textContent();
  await page.waitForTimeout(1500);
  await expect(timer).toHaveText(stopped!);
  await expect(projector.locator('.font-mono')).toHaveText(stopped!);
  await expect(phone.locator('.font-mono')).toHaveText(stopped!);
});

test('for people who ask for less motion, the scene starts paused', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const console_ = page.getByRole('figure', { name: 'The chair’s console during a general debate' });
  await expect(console_.getByRole('button', { name: 'Play' })).toBeVisible();
  const timer = console_.locator('.font-mono.text-4xl');
  const at = await timer.textContent();
  await page.waitForTimeout(1500);
  await expect(timer).toHaveText(at!);
});

test('organizer features are grouped in tabs that work from the keyboard, and the section nav marks where you are', async ({ page }) => {
  await page.goto('/');
  const tabs = page.getByRole('tablist', { name: 'When' });
  await expect(tabs.getByRole('tab', { name: 'Before the conference' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Before the conference' })).toContainText('Bring your spreadsheet');
  await tabs.getByRole('tab', { name: 'Before the conference' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'During' })).toBeFocused();
  await expect(page.getByRole('tabpanel', { name: 'During' })).toContainText('Printing');
  await page.keyboard.press('End');
  await expect(page.getByRole('tabpanel', { name: 'After' })).toContainText('Your data leaves with you');

  const nav = page.getByRole('navigation', { name: 'On this page' });
  await nav.getByRole('link', { name: 'Pricing' }).click();
  await expect(nav.getByRole('link', { name: 'Pricing' })).toHaveAttribute('aria-current', 'location');
  // The sticky header does not cover the section's heading.
  const top = await page.getByRole('heading', { level: 2, name: 'Pricing' }).evaluate((h) => h.getBoundingClientRect().top);
  const header = await page.locator('header').first().evaluate((h) => h.getBoundingClientRect().bottom);
  expect(top).toBeGreaterThanOrEqual(header);
});
