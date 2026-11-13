import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const PORT = 3100;
const at = (host: string, path = '/') => `http://${host}.localhost:${PORT}${path}`;

async function signIn(page: Page, host: string, email: string, labels = { email: 'Email', password: 'Password', button: 'Sign in' }) {
  await page.goto(at(host, '/login'));
  await page.getByLabel(labels.email).fill(email);
  await page.getByLabel(labels.password).fill('correct-password');
  await page.getByRole('button', { name: labels.button }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}
const save = async (page: Page, region: string, button = 'Save draft') => {
  await page.getByRole('region', { name: region }).getByRole('button', { name: button }).click();
  await page.waitForURL(/done=/);
};
const publish = async (page: Page, region: string) => {
  await page.getByRole('region', { name: region }).getByRole('button', { name: 'Publish' }).click();
  await page.waitForURL(/done=published/);
};

test('an Arabic school is written right to left, with its own texts and English for the rest', async ({ page }) => {
  await page.goto(at('kappa', '/login'));
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('تسجيل الدخول إلى مدرسة كابا');
  await expect(page.getByRole('button', { name: 'دخول' })).toBeVisible();
  // Not translated by the school: English, never a blank or a key.
  await expect(page.getByLabel('Password')).toBeVisible();

  // The layout mirrors: the school's name starts on the right.
  const width = page.viewportSize()!.width;
  const name = await page.locator('header.app-header > span').boundingBox();
  expect(name!.x).toBeGreaterThan(width / 2);

  // Switching to English turns the page left to right; the choice is remembered in this browser.
  await page.getByLabel('Language').selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in to مدرسة كابا');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('the product\'s own pages keep English left to right', async ({ page }) => {
  await page.goto(`http://localhost:${PORT}/`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

test('a school adds French, and an unknown language code is refused with a reason', async ({ page }) => {
  await signIn(page, 'lambda', 'owner@lambda.test');
  await page.goto(at('lambda', '/settings'));
  const language = page.getByRole('region', { name: 'Language' });
  await language.getByLabel('Languages').fill('en, es, french');
  await language.getByRole('button', { name: 'Save draft' }).click();
  await expect(language.locator('p[role="alert"]').first()).toHaveText(/Check the language codes/);
  await expect(language.getByLabel('Languages')).toHaveValue('en, es, french');

  await language.getByLabel('Languages').fill('EN, es, fr');
  await save(page, 'Language');
  // The default-language list follows the languages, named in the reader's language.
  await expect(page.getByRole('region', { name: 'Language' }).getByLabel('Default language').locator('option')).toHaveText(['English (en)', 'Spanish (es)', 'French (fr)']);
  await publish(page, 'Language');

  // The translations card reports what French still lacks; English and Spanish are complete.
  const translations = page.getByRole('region', { name: 'Translations' });
  await expect(translations.getByText(/^French: \d+ texts missing, shown in English/)).toBeVisible();
  await expect(translations.getByText(/^Spanish: complete/)).toBeVisible();
  // Text written per language now offers French too.
  await expect(page.getByRole('region', { name: 'Identity' }).getByLabel('French')).toBeVisible();
});

test('the translation editor: search, broken texts refused and kept, saved as a draft, published', async ({ page }) => {
  await signIn(page, 'lambda', 'owner@lambda.test');
  await page.goto(at('lambda', '/settings'));
  await page.getByRole('link', { name: 'Open the translation editor' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Translations');
  await expect(page.getByLabel('Language', { exact: true }).last()).toHaveValue('fr');

  await page.getByRole('searchbox', { name: 'Search' }).fill('sign in');
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(page.getByText(/texts shown/)).toBeVisible();
  const title = page.getByLabel('Your text: auth.signIn.title');
  const button = page.getByLabel('Your text: auth.signIn', { exact: true });
  await title.fill('Connexion à {nom}');
  await button.fill('Se connecter');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('auth.signIn.title: keep the words in braces as in English.')).toBeVisible();
  await expect(page.getByText('1 text needs a fix. Nothing was saved.')).toBeVisible();
  await expect(title).toHaveValue('Connexion à {nom}');

  await title.fill('Connexion à {name}');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.waitForURL(/done=draft/);
  await expect(page.getByRole('status')).toHaveText(/Draft saved. Publish the Translations section/);

  await page.goto(at('lambda', '/settings'));
  await publish(page, 'Translations');
  await expect(page.getByRole('region', { name: 'Translations' }).getByText(/^French: .* · 2 texts changed/)).toBeVisible();
});

test('anyone can switch to French; signed-in people keep the choice on their profile', async ({ page, browser }) => {
  // A visitor: remembered in the browser.
  await page.goto(at('lambda', '/login'));
  await page.getByLabel('Language').selectOption('fr');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Connexion à Lambda School');
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');

  // Signed in on one device, chosen once; another device follows the profile.
  const first = await (await browser.newContext()).newPage();
  await signIn(first, 'lambda', 'owner@lambda.test');
  await first.getByLabel('Language').selectOption('es');
  await expect(first.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  const second = await (await browser.newContext()).newPage();
  await signIn(second, 'lambda', 'owner@lambda.test');
  await expect(second.locator('html')).toHaveAttribute('lang', 'es');
  await expect(second.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
  // Back to English for the next tests.
  await second.getByLabel('Idioma').selectOption('en');
  await expect(second.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await first.context().close();
  await second.context().close();
});

test('changing the words of a school changes every text that uses them', async ({ page, browser }) => {
  await signIn(page, 'lambda', 'owner@lambda.test');
  await page.goto(at('lambda', '/settings'));
  const words = page.getByRole('region', { name: 'Words' });
  await words.getByLabel('Set of words').selectOption('school');
  await words.getByRole('group', { name: 'Organising team' }).getByLabel('English').fill('Secretariat of Lambda');
  await save(page, 'Words');
  await publish(page, 'Words');

  // The live preview sample uses the words.
  await expect(page.getByTestId('theme-preview')).toContainText('Students present: 14 of 15');

  // Someone signed in without access is told whom to ask, in the school's words.
  const stranger = await (await browser.newContext()).newPage();
  await signIn(stranger, 'lambda', 'stranger@else.test');
  await expect(stranger.getByText('Ask the Secretariat of Lambda to invite you.')).toBeVisible();
  await stranger.context().close();
});

test('texts download as a spreadsheet and come back as a draft', async ({ page }, testInfo) => {
  await signIn(page, 'lambda', 'owner@lambda.test');
  await page.goto(at('lambda', '/settings/translations?locale=fr'));
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download as CSV' }).click()]);
  expect(download.suggestedFilename()).toBe('lambda-texts-fr.csv');
  const file = testInfo.outputPath('texts.csv');
  await download.saveAs(file);
  const csv = readFileSync(file, 'utf8');
  expect(csv.startsWith('﻿key,en,fr\r\n')).toBe(true);
  expect(csv).toContain('auth.signIn,Sign in,Se connecter');

  // Edit in the "spreadsheet": translate sign out, and leave everything else as it was.
  writeFileSync(file, csv.replace('auth.signOut,Sign out,\r\n', 'auth.signOut,Sign out,Se déconnecter\r\n'));
  await page.getByLabel('CSV file (key, English, translation)').setInputFiles(file);
  await page.getByRole('button', { name: 'Upload CSV as draft' }).click();
  await page.waitForURL(/done=draft/);
  await page.getByRole('searchbox', { name: 'Search' }).fill('auth.signOut');
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(page.getByLabel('Your text: auth.signOut')).toHaveValue('Se déconnecter');

  // A file in another layout is refused.
  await page.getByLabel('CSV file (key, English, translation)').setInputFiles({ name: 'x.csv', mimeType: 'text/csv', buffer: Buffer.from('name,value\nx,y\n') });
  await page.getByRole('button', { name: 'Upload CSV as draft' }).click();
  await expect(page.getByText(/That file is not in the expected layout/)).toBeVisible();
});

test('only people who may edit settings reach the editor or the download', async ({ page }) => {
  expect((await page.goto(at('lambda', '/settings/translations/export?locale=fr')))!.status()).toBe(403);
  await page.goto(at('lambda', '/settings/translations'));
  await expect(page).toHaveURL(at('lambda', '/login'));
});
