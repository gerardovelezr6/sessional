import { expect, test, type Page } from '@playwright/test';
import { makePng } from '../unit/support/png';

test.describe.configure({ mode: 'serial' });

const PORT = 3100;
const at = (path = '/') => `http://eta.localhost:${PORT}${path}`;
const style = (page: Page, selector: string, property: string) =>
  page.locator(selector).first().evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property);
const png = (w: number, h: number, rgb?: [number, number, number]) => ({ name: 'image.png', mimeType: 'image/png', buffer: Buffer.from(makePng(w, h, rgb)) });

async function openDesign(page: Page) {
  await page.goto(at('/login'));
  await page.getByLabel('Email').fill('owner@eta.test');
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
  await page.goto(at('/settings'));
  return page.getByRole('region', { name: 'Design' });
}

async function saveAndPublish(page: Page) {
  const design = page.getByRole('region', { name: 'Design' });
  await design.getByRole('button', { name: 'Save draft' }).click();
  await page.waitForURL(/done=draft/);
  await page.getByRole('region', { name: 'Design' }).getByRole('button', { name: 'Publish' }).click();
  await page.waitForURL(/done=published/);
}

test('every school page has a header with the school name until a logo is uploaded', async ({ page }) => {
  await page.goto(at('/login'));
  await expect(page.locator('header.app-header > span')).toHaveText('Logo School');
});

test('the live preview follows the form before anything is saved', async ({ page }) => {
  const design = await openDesign(page);
  // The default design needs no correction, so no note about adjusted colours.
  await expect(design.getByText('Some colours were adjusted')).toHaveCount(0);
  const preview = page.getByTestId('theme-preview');
  const button = preview.locator('.btn-primary');
  const before = await button.evaluate((el) => getComputedStyle(el).backgroundColor);

  await design.getByLabel('Brand colour').fill('#0F766E');
  await expect.poll(() => button.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(15, 118, 110)');
  await design.getByLabel('Corners').selectOption('none');
  await expect.poll(() => button.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('0px');
  await design.getByLabel('Page header').selectOption('brand');
  await expect.poll(() => preview.locator('.app-header').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(15, 118, 110)');
  await design.getByLabel('Tabs').selectOption('pill');
  await expect.poll(() => preview.locator('[aria-selected="true"]').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(15, 118, 110)');

  // Half-typed colours are ignored instead of breaking the preview.
  await design.getByLabel('Brand colour').fill('#0F7');
  await expect.poll(() => button.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(before);

  // Dark sample.
  await preview.page().getByRole('button', { name: 'Dark', exact: true }).click();
  const darkBg = await preview.evaluate((el) => getComputedStyle(el).backgroundColor);
  const [r, g, b] = darkBg.match(/\d+/g)!.map(Number);
  expect((r! + g! + b!) / 3).toBeLessThan(60);

  // Nothing was saved: the page itself still has the old look, and leaving loses nothing live.
  await page.goto(at('/settings'));
  await expect(page.getByText('Draft saved, not live yet')).toHaveCount(0);
  expect(await style(page, 'header.app-header', 'background-color')).not.toBe('rgb(15, 118, 110)');
});

test('bad images are refused with a reason, and nothing is saved', async ({ page }) => {
  const design = await openDesign(page);
  await design.getByLabel('Logo: Choose a file').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from('this is not an image') });
  await design.getByLabel('Browser icon: Choose a file').setInputFiles(png(64, 32));
  await design.getByRole('button', { name: 'Save draft' }).click();
  await expect(design.getByText('Use a PNG, JPEG or WebP image (a PNG for the browser icon).')).toBeVisible();
  await expect(design.getByText('The browser icon must be square.')).toBeVisible();
  await page.goto(at('/settings'));
  await expect(page.getByText('Draft saved, not live yet')).toHaveCount(0);
});

test('a logo and a browser icon are uploaded, previewed, published and shown on every page', async ({ page, browser }) => {
  const design = await openDesign(page);
  await design.getByLabel('Logo: Choose a file').setInputFiles(png(240, 64, [200, 30, 40]));
  // The preview shows the chosen file at once.
  await expect(page.getByTestId('theme-preview').locator('.app-header img')).toHaveAttribute('src', /^blob:/);
  await design.getByLabel('Browser icon: Choose a file').setInputFiles(png(64, 64));
  await design.getByLabel('Page header').selectOption('brand');
  await design.getByLabel('Page titles').selectOption('bar');
  await saveAndPublish(page);

  // Stored under the school's own folder, named by content, and actually served.
  const logo = page.getByRole('region', { name: 'Design' }).locator('img').first();
  await expect(logo).toHaveAttribute('src', /\/storage\/v1\/object\/public\/public-assets\/00000000-0000-4000-8000-000000000008\/logo-[0-9a-f]{16}\.png$/);

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(at('/login'));
  const headerLogo = visitor.locator('header.app-header img');
  await expect(headerLogo).toHaveAttribute('alt', 'Logo School');
  expect(await headerLogo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(240);
  const icon = await visitor.locator('link[rel="icon"]').first().getAttribute('href');
  expect(icon).toMatch(/public-assets\/00000000-0000-4000-8000-000000000008\/favicon-[0-9a-f]{16}\.png$/);
  // Brand-coloured header and a title bar.
  expect(await style(visitor, 'header.app-header', 'color')).toBe('rgb(255, 255, 255)');
  expect(await visitor.locator('h1.page-title').evaluate((el) => getComputedStyle(el, '::after').display)).toBe('block');
  await visitor.context().close();

  // Saving the form again without choosing a file keeps the images.
  await page.getByRole('region', { name: 'Design' }).getByLabel('Spacing').selectOption('compact');
  await saveAndPublish(page);
  await expect(page.locator('header.app-header img')).toHaveAttribute('src', /logo-[0-9a-f]{16}\.png$/);
});

test('an image can be removed', async ({ page }) => {
  const design = await openDesign(page);
  await design.getByLabel('Logo: Remove').check();
  await expect(page.getByTestId('theme-preview').locator('.app-header')).toHaveText('Logo School');
  await saveAndPublish(page);
  await expect(page.locator('header.app-header > span')).toHaveText('Logo School');
  await expect(page.locator('header.app-header img')).toHaveCount(0);
  // The icon was not touched.
  await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute('href', /favicon-/);
});

test('a forged image path pointing at another school is refused', async ({ page }) => {
  const design = await openDesign(page);
  await design.locator('input[type=hidden][name=favicon]').evaluate((el: HTMLInputElement) => {
    el.value = '00000000-0000-4000-8000-000000000001/favicon-0123456789abcdef.png';
  });
  await design.getByRole('button', { name: 'Save draft' }).click();
  await expect(design.getByText('Some values are not valid. Nothing was saved.')).toBeVisible();
});

test('the settings sections are tabs, styled by the design', async ({ page }) => {
  await openDesign(page);
  const nav = page.getByRole('navigation', { name: 'Sections' });
  await expect(nav.getByRole('link')).toHaveText(['Identity', 'Language', 'Words', 'Translations', 'Design', 'People and sign-in']);
  await expect(nav.getByRole('link', { name: 'Identity' })).toHaveAttribute('aria-current', 'location');
  await expect(nav.locator('[aria-current]')).toHaveCount(1);

  // After saving a section, that section is the current tab.
  const design = page.getByRole('region', { name: 'Design' });
  await design.getByLabel('Tabs').selectOption('boxed');
  await design.getByRole('button', { name: 'Save draft' }).click();
  await page.waitForURL(/section=theme/);
  const current = page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Design' });
  await expect(current).toHaveAttribute('aria-current', 'location');
  // The current tab is visibly marked (live design: underline from the preset).
  expect(await current.evaluate((el) => getComputedStyle(el).boxShadow)).toContain('inset');
});
