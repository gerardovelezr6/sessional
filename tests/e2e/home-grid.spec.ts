import { expect, test, type Page } from '@playwright/test';
import { choose, openSection, saveAndPublish } from './support/settings';

test.describe.configure({ mode: 'serial' });

const at = (path = '/') => `http://grid.localhost:3100${path}`;

async function signIn(page: Page) {
  await page.goto(at('/login'));
  await page.getByLabel('Email').fill('owner@grid.test');
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}

test('the home page opens on a banner and the committees with their live status', async ({ page }) => {
  await signIn(page);
  const banner = page.locator('.home-banner');
  await expect(banner.getByRole('heading', { level: 1 })).toHaveText('Grid MUN');
  await expect(banner).toContainText('Diplomacy in action');
  await expect(banner).toContainText('March 12–14, 2027 · City Hall');
  // The header carries the school's name and tagline, the menu on the other side.
  await expect(page.locator('header .app-identity-name')).toHaveText('Grid School');
  await expect(page.locator('header .app-identity-tagline')).toHaveText('Diplomacy in action');

  const ga = page.getByRole('list', { name: 'General Assembly' });
  await expect(ga.getByRole('listitem')).toHaveCount(2);
  const disec = ga.getByRole('listitem').filter({ hasText: 'Disarmament and Security' });
  await expect(disec).toContainText('In session');
  await expect(disec).toContainText('Session 1 · Formal debate');
  await expect(disec.getByRole('link', { name: 'Run session' })).toHaveAttribute('href', /\/console$/);
  await expect(ga.getByRole('listitem').filter({ hasText: 'Environment Programme' })).toContainText('Not started');

  // A confidential topic is never shown on the card.
  const cabinet = page.getByRole('list', { name: 'Other committees' }).getByRole('listitem');
  await expect(cabinet).toContainText('Confidential topic');
  await expect(page.getByText('This must not show')).toHaveCount(0);
});

test('committees are filtered by status and found by name or topic', async ({ page }) => {
  await signIn(page);
  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'In session' }).click();
  await expect(page.locator('main li.card')).toHaveCount(1);
  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'All' }).click();
  await page.getByRole('searchbox', { name: 'Search name or topic…' }).fill('climate');
  await expect(page.locator('main li.card')).toHaveText([/Environment Programme/]);
  await page.getByRole('searchbox', { name: 'Search name or topic…' }).fill('nothing like this');
  await expect(page.getByText('No committees match.')).toBeVisible();
});

test('the banner can be switched off', async ({ page }) => {
  await signIn(page);
  const design = await openSection(page, 'grid', 'theme');
  await choose(design, 'Home page banner', 'Hide');
  await saveAndPublish(design);
  await page.goto(at('/'));
  await expect(page.locator('.home-banner')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Grid MUN');
});
