import { expect, test } from '@playwright/test';

const PORT = 3100;
const app = (path = '/') => `http://app.localhost:${PORT}${path}`;

async function signIn(page: import('@playwright/test').Page, email: string) {
  await page.goto(app('/login'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in to see your conferences');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(app('/'));
}

test('signed-out visitors are sent to sign in, under the product\'s own wordmark', async ({ page }) => {
  await page.goto(app('/'));
  await expect(page).toHaveURL(app('/login'));
  await expect(page.locator('header.app-header img')).toHaveAttribute('alt', 'sessional');
});

test('a person in several schools sees each one with their role, and a link to its address', async ({ page }) => {
  await signIn(page, 'multi@else.test');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your conferences');
  const items = page.getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('School Alpha');
  await expect(items.nth(0)).toContainText('Your role: Chair');
  await expect(items.nth(1)).toContainText('School Beta');
  await expect(items.nth(1)).toContainText('Your role: High Command');
  await expect(page.getByText('Frozen School')).toHaveCount(0);
  await expect(items.nth(0).getByRole('link', { name: 'Open' })).toHaveAttribute('href', 'http://alpha.localhost:3100/');

  // Sessions are per address: the school asks the person to sign in on its own address.
  await items.nth(0).getByRole('link', { name: 'Open' }).click();
  await expect(page).toHaveURL('http://alpha.localhost:3100/login');
});

test('someone with no school is told how to get one', async ({ page }) => {
  await signIn(page, 'stranger@else.test');
  await expect(page.getByText('You do not belong to any conference yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(app('/login'));
});

test('the account area cannot be reached through a school or the main address', async ({ page }) => {
  expect((await page.goto(`http://localhost:${PORT}/p/app`))?.status()).toBe(404);
  expect((await page.goto(`http://alpha.localhost:${PORT}/p/app`))?.status()).toBe(404);
  expect((await page.goto(`http://admin.localhost:${PORT}/`))?.status()).toBe(404);
});
