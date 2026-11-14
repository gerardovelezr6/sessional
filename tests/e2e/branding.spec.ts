import { expect, test, type Page } from '@playwright/test';
import { makePng } from '../unit/support/png';
import { choose } from './support/settings';

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
  await page.goto(at('/settings?section=theme'));
  return page.locator('section#theme');
}

async function saveAndPublish(page: Page) {
  await page.locator('section#theme').getByRole('button', { name: 'Save and publish' }).click();
  await page.waitForURL(/done=published/);
}

test('every school page has a header with the school name until a logo is uploaded', async ({ page }) => {
  await page.goto(at('/login'));
  await expect(page.locator('header.app-header a > span')).toHaveText('Logo School');
});

test('the live preview follows the form before anything is saved', async ({ page }) => {
  const design = await openDesign(page);
  // The default design needs no correction, so no note about adjusted colours.
  await expect(design.getByText('Some colours were adjusted')).toHaveCount(0);
  const preview = page.getByTestId('theme-preview');
  const button = preview.locator('.btn-primary');
  const before = await button.evaluate((el) => getComputedStyle(el).backgroundColor);

  const background = () => button.evaluate((el) => getComputedStyle(el).backgroundColor);

  // Three ways to choose a colour: a suggested swatch, the colour picker, or a typed code.
  await design.getByLabel('Use #B91C1C').click();
  await expect.poll(background).toBe('rgb(185, 28, 28)');
  await design.getByLabel('Brand colour', { exact: true }).fill('#6d28d9');
  await expect.poll(background).toBe('rgb(109, 40, 217)');
  await design.getByLabel('Brand colour, colour code').fill('#0F766E');
  await expect.poll(background).toBe('rgb(15, 118, 110)');
  await choose(design, 'Corners', 'Square');
  await expect.poll(() => button.evaluate((el) => getComputedStyle(el).borderRadius)).toBe('0px');
  await choose(design, 'Page header', 'In the brand colour');
  await expect.poll(() => preview.locator('.app-header').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(15, 118, 110)');
  await choose(design, 'Tabs', 'Filled');
  await expect.poll(() => preview.locator('[aria-selected="true"]').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(15, 118, 110)');

  // Half-typed colours are ignored instead of breaking the preview.
  await design.getByLabel('Brand colour, colour code').fill('#0F7');
  await expect.poll(background).toBe(before);
  // "Use the design's colour" goes back to the preset's.
  await design.getByLabel('Brand colour, colour code').fill('#0F766E');
  await design.getByRole('button', { name: "Use the design's colour" }).first().click();
  await expect.poll(background).toBe(before);

  // Dark sample.
  await preview.page().getByRole('button', { name: 'Dark', exact: true }).click();
  const darkBg = await preview.evaluate((el) => getComputedStyle(el).backgroundColor);
  const [r, g, b] = darkBg.match(/\d+/g)!.map(Number);
  expect((r! + g! + b!) / 3).toBeLessThan(60);

  // Nothing was saved: the page itself still has the old look, and leaving loses nothing live.
  await page.goto(at('/settings?section=theme'));
  await expect(page.getByText('You have unpublished changes')).toHaveCount(0);
  expect(await style(page, 'header.app-header', 'background-color')).not.toBe('rgb(15, 118, 110)');
});

test('bad images are refused with a reason, and nothing is saved', async ({ page }) => {
  const design = await openDesign(page);
  await design.getByLabel('Logo: Choose a file').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from('this is not an image') });
  await design.getByLabel('Browser icon: Choose a file').setInputFiles(png(64, 32));
  await design.getByRole('button', { name: 'Save draft' }).click();
  await expect(design.getByText('Use a PNG, JPEG or WebP image (a PNG for the browser icon).')).toBeVisible();
  await expect(design.getByText('The browser icon must be square.')).toBeVisible();
  await page.goto(at('/settings?section=theme'));
  await expect(page.getByText('You have unpublished changes')).toHaveCount(0);
});

test('a logo and a browser icon are uploaded, previewed, published and shown on every page', async ({ page, browser }) => {
  const design = await openDesign(page);
  await design.getByLabel('Logo: Choose a file').setInputFiles(png(240, 64, [200, 30, 40]));
  // The preview shows the chosen file at once.
  await expect(page.getByTestId('theme-preview').locator('.app-header img')).toHaveAttribute('src', /^blob:/);
  await design.getByLabel('Browser icon: Choose a file').setInputFiles(png(64, 64));
  await choose(design, 'Page header', 'In the brand colour');
  await choose(design, 'Page titles', 'With a coloured bar');
  await saveAndPublish(page);

  // Stored under the school's own folder, named by content, and actually served.
  const logo = page.locator('section#theme').locator('img').first();
  await expect(logo).toHaveAttribute('src', /\/storage\/v1\/object\/public\/public-assets\/00000000-0000-4000-8000-000000000008\/logo-[0-9a-f]{16}\.png$/);

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(at('/login'));
  const headerLogo = visitor.locator('header.app-header img');
  // The name is written beside the logo, so the image itself is decorative.
  await expect(headerLogo).toHaveAttribute('alt', '');
  await expect(visitor.locator('header.app-header .app-identity-name')).toHaveText('Logo School');
  expect(await headerLogo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(240);
  const icon = await visitor.locator('link[rel="icon"]').first().getAttribute('href');
  expect(icon).toMatch(/public-assets\/00000000-0000-4000-8000-000000000008\/favicon-[0-9a-f]{16}\.png$/);
  // Brand-coloured header and a title bar.
  expect(await style(visitor, 'header.app-header', 'color')).toBe('rgb(255, 255, 255)');
  expect(await visitor.locator('h1.page-title').evaluate((el) => getComputedStyle(el, '::after').display)).toBe('block');
  await visitor.context().close();

  // Saving the form again without choosing a file keeps the images.
  await choose(page.locator('section#theme'), 'Spacing', 'Compact');
  await saveAndPublish(page);
  await expect(page.locator('header.app-header img')).toHaveAttribute('src', /logo-[0-9a-f]{16}\.png$/);
});

test('an image can be removed', async ({ page }) => {
  const design = await openDesign(page);
  await design.getByLabel('Logo: Remove').check();
  await expect(page.getByTestId('theme-preview').locator('.app-header')).toHaveText('Logo School');
  await saveAndPublish(page);
  await expect(page.locator('header.app-header a > span')).toHaveText('Logo School');
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

test('the settings menu marks the section being edited, in the school\'s style', async ({ page }) => {
  const design = await openDesign(page);
  const current = page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Design' });
  await expect(current).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('navigation', { name: 'Sections' }).locator('[aria-current]')).toHaveCount(1);
  expect(await current.evaluate((el) => getComputedStyle(el).boxShadow)).toContain('inset');

  // After saving, the same section is shown again.
  await choose(design, 'Tabs', 'Outlined');
  await design.getByRole('button', { name: 'Save draft' }).click();
  await page.waitForURL(/section=theme/);
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Design •' })).toHaveAttribute('aria-current', 'page');
});
