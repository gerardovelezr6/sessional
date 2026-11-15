import { expect, test, type Page } from '@playwright/test';

// The website editor: owners arrange the home page, menu, header and announcements; everyone
// sees the result once it is published.
test.describe.configure({ mode: 'serial' });

const PORT = 3100;
const COMMITTEE = '00000000-0000-4000-9300-000000000001';
const at = (path = '/') => `http://site.localhost:${PORT}${path}`;

async function signIn(page: Page, email: string) {
  await page.goto(at('/login'));
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}
const menu = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const blocks = (page: Page) => page.getByRole('list', { name: 'Blocks' });

test('the classic layout: initials beside the name, a short menu, the administration tabs', async ({ page }) => {
  await signIn(page, 'owner@site.test');
  await expect(page.locator('header .brand-mark')).toHaveText('SS');
  await expect(menu(page).getByRole('link')).toHaveText(['Committees', 'Dashboard', 'High Command', 'Owner']);
  await menu(page).getByRole('link', { name: 'High Command' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('High Command');
  const tabs = page.getByRole('navigation', { name: 'Administration' });
  await expect(tabs.getByRole('link', { name: 'Live analytics' })).toHaveAttribute('aria-current', 'page');
  await tabs.getByRole('link', { name: 'Global documents' }).click();
  await expect(page.getByText('Coming soon')).toBeVisible();
  await menu(page).getByRole('link', { name: 'Owner' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Owner');
  await page.getByRole('navigation', { name: 'Owner settings' }).getByRole('link', { name: 'Website' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Website');
});

test('the owner adds a text block, hides the welcome line and publishes; the home page follows', async ({ page }) => {
  await signIn(page, 'owner@site.test');
  await page.goto(at('/settings/site'));
  await page.getByRole('button', { name: 'Add' }).last().click();
  const added = blocks(page).getByRole('listitem').last();
  await added.getByLabel('Heading (empty: the usual one), English').fill('Delegate handbook');
  await added.getByLabel('Text, English').fill('Read the handbook before Friday.');
  // Up above the committees.
  await added.getByRole('button', { name: 'Move up: Delegate handbook' }).click();
  const welcome = blocks(page).getByRole('listitem').filter({ has: page.getByText('“Welcome, name · Your role”.') });
  await welcome.getByLabel('Shown').uncheck();
  await page.getByRole('button', { name: 'Save and publish' }).click();
  await page.waitForURL(/done=published/);

  await page.goto(at('/'));
  await expect(page.getByRole('heading', { name: 'Delegate handbook' })).toBeVisible();
  await expect(page.getByText('Read the handbook before Friday.')).toBeVisible();
  await expect(page.getByText(/^Welcome, Wes Website/)).toHaveCount(0);
  // The new block sits above the committees.
  const order = await page.locator('main h2').allInnerTexts();
  expect(order.indexOf('Delegate handbook')).toBeLessThan(order.indexOf('Committees'));
});

test('the menu is renamed and reordered; header initials and an urgent announcement are set', async ({ page }) => {
  await signIn(page, 'owner@site.test');
  await page.goto(at('/settings/site?part=menu'));
  const items = page.getByRole('list', { name: 'Menu items' });
  await items.getByLabel('Name: Dashboard, English').fill('My desk');
  await items.getByRole('checkbox', { name: 'Settings' }).check();
  await page.getByRole('tab', { name: 'Header' }).click();
  await page.getByRole('textbox', { name: 'Initials' }).fill('WEB');
  await page.getByRole('button', { name: 'Save and publish' }).click();
  await page.waitForURL(/done=published&part=header/);
  // Announcements have their own page, under High Command.
  await page.goto(at('/announcements'));
  await page.getByRole('button', { name: 'Add' }).click();
  const a = page.getByRole('list', { name: 'Announcements' }).getByRole('listitem').last();
  await a.getByLabel('Message, English').fill('Room change: the council meets in hall B.');
  await a.getByLabel('Kind').selectOption({ label: 'Urgent' });
  await page.getByRole('button', { name: 'Publish announcements' }).click();
  await expect(page.getByText('Published. They show now.')).toBeVisible();

  await page.goto(at('/'));
  await expect(menu(page).getByRole('link')).toHaveText(['Committees', 'My desk', 'High Command', 'Owner', 'Settings']);
  await expect(page.locator('header .brand-mark')).toHaveText('WEB');
  await expect(page.getByRole('alert').filter({ hasText: 'Room change' })).toContainText('Urgent');
});

test('a chair sees the announcement in the console, has no administration, and cannot open the editor', async ({ page }) => {
  await signIn(page, 'chair@site.test');
  await expect(menu(page).getByRole('link')).toHaveText(['Committees', 'My desk']);
  await page.goto(at(`/committees/${COMMITTEE}/console`));
  await expect(page.getByText('Room change: the council meets in hall B.')).toBeVisible();
  await page.goto(at('/settings/site'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('You do not have access to this page');
  await page.goto(at('/admin'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('You do not have access to this page');
});

test('an unsafe link is refused with a reason, and nothing is saved', async ({ page }) => {
  await signIn(page, 'owner@site.test');
  await page.goto(at('/settings/site?part=menu'));
  await page.getByText('Your own links').click();
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByLabel('Address').fill('javascript:alert(1)');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/^Some website settings need fixing. Check: .*links/)).toBeVisible();
  await page.goto(at('/'));
  await expect(menu(page).getByRole('link')).toHaveText(['Committees', 'My desk', 'High Command', 'Owner', 'Settings']);
});
