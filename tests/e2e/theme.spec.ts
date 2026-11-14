import { expect, test, type Page } from '@playwright/test';
import { choose, saveAndPublish } from './support/settings';

test.describe.configure({ mode: 'serial' });

const PORT = 3100;
const at = (host: string, path = '/') => `http://${host}:${PORT}${path}`;
const style = (page: Page, selector: string, property: string) =>
  page.locator(selector).first().evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property);

// WCAG contrast between an element's text and the background behind it, measured in the browser.
// The background is the first ancestor (or the element itself) with an opaque background.
async function contrastOf(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((el) => {
    const lum = (rgb: string) => {
      const [r, g, b] = rgb.match(/[\d.]+/g)!.slice(0, 3).map((v) => {
        const s = Number(v) / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    let bgEl: Element | null = el;
    while (bgEl && /rgba\(0, 0, 0, 0\)|transparent/.test(getComputedStyle(bgEl).backgroundColor)) bgEl = bgEl.parentElement;
    const background = getComputedStyle(bgEl ?? document.body).backgroundColor;
    const [a, b] = [lum(getComputedStyle(el).color), lum(background)].sort((x, y) => y - x);
    return (a! + 0.05) / (b! + 0.05);
  });
}

test('a school that changed nothing has the classic conference look', async ({ page }) => {
  await page.goto(at('alpha.localhost', '/login'));
  expect(await style(page, 'body', 'background-color')).toBe('rgb(255, 255, 255)');
  expect(await style(page, 'button[type=submit]', 'background-color')).toBe('rgb(30, 64, 175)');
  expect(await style(page, 'button[type=submit]', 'border-radius')).toBe('0px');
  expect(await style(page, 'button[type=submit]', 'text-transform')).toBe('uppercase');
  expect(await style(page, 'body', 'font-family')).toContain('Montserrat');
});

test("a school's published design arrives with the first HTML, for signed-out visitors too", async ({ page }) => {
  const res = await page.goto(at('delta.localhost', '/login'));
  const html = await res!.text();
  // In <head>, before any content: no flash of the default colours.
  const head = html.slice(0, html.indexOf('</head>'));
  expect(head).toContain('--s-color-primary:#7A1F2B');

  expect(await style(page, 'body', 'background-color')).toBe('rgb(255, 255, 255)');
  expect(await style(page, 'button[type=submit]', 'background-color')).toBe('rgb(122, 31, 43)');
  // Flat institutional: square corners, uppercase labels, no shadow.
  expect(await style(page, 'button[type=submit]', 'border-radius')).toBe('0px');
  expect(await style(page, '.card', 'border-radius')).toBe('0px');
  expect(await style(page, '.card .label', 'text-transform')).toBe('uppercase');
  expect(await style(page, '.card', 'box-shadow')).toBe('none');
});

test('one school\'s design does not leak into another, or into the marketing site', async ({ page }) => {
  await page.goto(at('delta.localhost', '/login'));
  await page.goto(at('alpha.localhost', '/login'));
  expect(await style(page, 'button[type=submit]', 'background-color')).toBe('rgb(30, 64, 175)');
  await page.goto(at('localhost'));
  expect(await style(page, 'body', 'background-color')).toBe('rgb(244, 241, 234)');
});

test('an owner redesigns the school: draft, preview, publish; unreadable choices are corrected', async ({ page, browser }) => {
  await page.goto(at('zeta.localhost', '/login'));
  await page.getByLabel('Email').fill('owner@zeta.test');
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
  await page.goto(at('zeta.localhost', '/settings?section=theme'));
  let design = page.locator('section#theme');

  // Not a colour: refused, nothing saved, and what was typed stays.
  await design.getByLabel('Brand colour, colour code').fill('red');
  await design.getByRole('button', { name: 'Save draft' }).click();
  await expect(design.getByText('Some values are not valid. Nothing was saved.')).toBeVisible();
  await expect(design.getByLabel('Brand colour, colour code')).toHaveValue('red');

  // A rounded preset, with a brand colour far too pale for a button on a light page.
  await choose(design, 'Design preset', 'Modern rounded');
  await design.getByLabel('Brand colour, colour code').fill('#FDE68A');
  await choose(design, 'Uppercase labels', 'On');
  await design.getByRole('button', { name: 'Save draft' }).click();
  await page.waitForURL(/done=draft/);
  design = page.locator('section#theme');
  await expect(design.getByText(/^You have unpublished changes/)).toBeVisible();
  // The choices are kept: the card and the colour show what was saved.
  await expect(design.getByRole('radio', { name: /Modern rounded/ })).toBeChecked();
  await expect(design.getByLabel('Brand colour', { exact: true })).toHaveValue('#fde68a');
  // Still the old look: a draft is not live.
  expect(await style(page, '.btn-primary', 'border-radius')).toBe('0px');

  await design.getByRole('button', { name: 'Preview my drafts' }).click();
  await expect(page.getByText('Preview: you are seeing your unpublished drafts.')).toBeVisible();
  await expect.poll(() => style(page, '.btn-primary', 'border-radius')).toBe('14px');
  expect(await style(page, '.label', 'text-transform')).toBe('uppercase');
  // The pale colour was darkened until the button stands out, and its text reads.
  expect(await style(page, '.btn-primary', 'background-color')).not.toBe('rgb(253, 230, 138)');
  expect(await contrastOf(page, '.btn-primary')).toBeGreaterThanOrEqual(4.5);
  expect(await contrastOf(page, 'h1')).toBeGreaterThanOrEqual(7);
  expect(await contrastOf(page, '.label')).toBeGreaterThanOrEqual(4.5);
  // The settings page explains that a colour was changed to keep text readable.
  await expect(page.getByText('Some colours were adjusted so that text stays readable.')).toBeVisible();

  // A visitor still sees the old design.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(at('zeta.localhost', '/login'));
  expect(await style(visitor, 'button[type=submit]', 'border-radius')).toBe('0px');

  await page.getByRole('button', { name: 'Leave preview' }).first().click();
  await page.goto(at('zeta.localhost', '/settings?section=theme'));
  await page.locator('section#theme').getByRole('button', { name: 'Publish now' }).click();
  await page.waitForURL(/done=published/);
  await expect(page.locator('section#theme').getByRole('status')).toHaveText('Published. It is live now.');

  await visitor.reload();
  expect(await style(visitor, 'button[type=submit]', 'border-radius')).toBe('14px');
  expect(await contrastOf(visitor, 'button[type=submit]')).toBeGreaterThanOrEqual(4.5);
  await visitor.context().close();
});

test('automatic mode follows the device: dark colours for a device set to dark', async ({ browser }) => {
  const owner = await (await browser.newContext()).newPage();
  await owner.goto(at('zeta.localhost', '/login'));
  await owner.getByLabel('Email').fill('owner@zeta.test');
  await owner.getByLabel('Password').fill('correct-password');
  await owner.getByRole('button', { name: 'Sign in' }).click();
  await owner.waitForURL((url) => !url.pathname.endsWith('/login'));
  await owner.goto(at('zeta.localhost', '/settings?section=theme'));
  const design = owner.locator('section#theme');
  await choose(design, 'Light or dark', 'Automatic');
  await saveAndPublish(design);
  await owner.context().close();

  for (const scheme of ['light', 'dark'] as const) {
    const page = await (await browser.newContext({ colorScheme: scheme })).newPage();
    await page.goto(at('zeta.localhost', '/login'));
    const lightness = await page.evaluate(() => {
      const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/\d+/g)!.map(Number);
      return (r! + g! + b!) / 3;
    });
    if (scheme === 'light') expect(lightness).toBeGreaterThan(220);
    else expect(lightness).toBeLessThan(60);
    // Text on cards and the button stay readable in both.
    expect(await contrastOf(page, 'button[type=submit]')).toBeGreaterThanOrEqual(4.5);
    expect(await contrastOf(page, 'h1')).toBeGreaterThanOrEqual(7);
    expect(await contrastOf(page, '.card .label')).toBeGreaterThanOrEqual(4.5);
    await page.context().close();
  }
});
