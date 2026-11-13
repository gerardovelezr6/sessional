import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const PORT = 3100;
const at = (host: string, path = '/') => `http://${host}.localhost:${PORT}${path}`;
const style = (page: Page, selector: string, property: string) =>
  page.locator(selector).first().evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property);

async function openSettings(page: Page, host: string) {
  await page.goto(at(host, '/login'));
  await page.getByLabel('Email').fill(`owner@${host}.test`);
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
  await page.goto(at(host, '/settings'));
  return page.getByRole('region', { name: 'Design' });
}
async function publishDesign(page: Page) {
  await page.getByRole('region', { name: 'Design' }).getByRole('button', { name: 'Publish' }).click();
  await page.waitForURL(/done=published/);
}

test('unsafe or unreadable custom CSS is refused line by line, and nothing is saved', async ({ page }) => {
  const design = await openSettings(page, 'theta');
  await design.getByLabel('Custom CSS (advanced)').fill(`.card { display: none }
body { color: #000 }
.btn-primary { background-image: url(https://evil.example/x.png) }`);
  await design.getByRole('button', { name: 'Save draft' }).click();
  // url() is refused outright, before anything else is read.
  await expect(design.getByText(/Line 3: “url\(” is not allowed\./)).toBeVisible();

  await design.getByLabel('Custom CSS (advanced)').fill(`.card { display: none }
body { color: #000 }
.label { color: #EEEEEE }`);
  await design.getByRole('button', { name: 'Save draft' }).click();
  const errors = design.locator('p[role="alert"]').first();
  await expect(errors).toContainText('Line 1: the property “display” is not allowed.');
  await expect(errors).toContainText('Line 2: the selector “body” is not allowed.');
  await expect(errors).toContainText('Line 3: text would be hard to read');
  // What was typed is still there to fix.
  await expect(design.getByLabel('Custom CSS (advanced)')).toHaveValue(/display: none/);
  await page.goto(at('theta', '/settings'));
  await expect(page.getByText('Draft saved, not live yet')).toHaveCount(0);
});

test('allowed custom CSS is rebuilt, scoped, and applied after publishing', async ({ page, browser }) => {
  const design = await openSettings(page, 'theta');
  await design.getByLabel('Custom CSS (advanced)').fill(`/* square buttons, roomier cards */
.btn-primary { border-radius: 0; letter-spacing: 0.1em }
.card { padding: 3rem }`);
  await design.getByRole('button', { name: 'Save draft' }).click();
  await page.waitForURL(/done=draft/);
  // Not live yet.
  expect(await style(page, '.btn-primary', 'border-radius')).not.toBe('0px');
  await publishDesign(page);

  const visitor = await (await browser.newContext()).newPage();
  const res = await visitor.goto(at('theta', '/login'));
  const html = await res!.text();
  expect(html).toContain(':root:root .btn-primary{border-radius:0;letter-spacing:0.1em}');
  expect(html).not.toContain('square buttons'); // comments are not passed through
  expect(await style(visitor, 'button[type=submit]', 'border-radius')).toBe('0px');
  expect(await style(visitor, '.card', 'padding-top')).toBe('48px');
  await visitor.context().close();
});

test('safe mode shows the page without custom CSS, and the CSS can be removed', async ({ page }) => {
  await openSettings(page, 'theta');
  expect(await style(page, '.btn-primary', 'border-radius')).toBe('0px');
  await page.goto(at('theta', '/settings?safe-mode'));
  await expect(page.getByText('Safe mode: custom CSS is switched off on this page.')).toBeVisible();
  expect(await style(page, '.btn-primary', 'border-radius')).toBe('8px');

  // A visitor cannot switch safe mode on by sending the internal header themselves.
  const visitor = await (await page.context().browser()!.newContext({ extraHTTPHeaders: { 'x-sessional-safe-mode': '1' } })).newPage();
  const forged = await visitor.goto(at('theta', '/login'));
  expect(await forged!.text()).toContain(':root:root .btn-primary{border-radius:0');
  await expect(visitor.getByText('Safe mode')).toHaveCount(0);
  await visitor.context().close();

  await page.getByRole('button', { name: 'Remove custom CSS' }).click();
  await page.waitForURL(/done=draft/);
  await expect(page.getByRole('region', { name: 'Design' }).getByLabel('Custom CSS (advanced)')).toHaveValue('');
  await publishDesign(page);
  expect(await style(page, '.btn-primary', 'border-radius')).toBe('8px');
});

test('a design is exported as a file and imported into another school as a draft', async ({ page, browser }, testInfo) => {
  const design = await openSettings(page, 'theta');
  await design.getByLabel('Design preset').selectOption('playful-school');
  await design.getByLabel('Brand colour').fill('#0F766E');
  await design.getByRole('button', { name: 'Save draft' }).click();
  await page.waitForURL(/done=draft/);

  const section = page.getByRole('region', { name: 'Design' });
  await section.getByText('Export or import').click();
  const [download] = await Promise.all([page.waitForEvent('download'), section.getByRole('link', { name: 'Download as a file' }).click()]);
  expect(download.suggestedFilename()).toBe('theta-theme.json');
  const file = testInfo.outputPath('theta-theme.json');
  await download.saveAs(file);
  const pack = JSON.parse(readFileSync(file, 'utf8'));
  expect(pack).toMatchObject({ format: 'sessional-pack', version: 1, kind: 'theme', data: { preset: 'playful-school', brand: '#0F766E' } });
  expect('logo' in pack.data).toBe(false);

  // Another school imports it.
  const other = await (await browser.newContext()).newPage();
  const otherDesign = await openSettings(other, 'iota');
  await otherDesign.getByText('Export or import').click();
  await otherDesign.getByLabel('Settings file (.json)').setInputFiles(file);
  await otherDesign.getByRole('button', { name: 'Import as draft' }).click();
  await other.waitForURL(/done=imported/);
  await expect(other.getByRole('status').filter({ hasText: 'Imported as a draft. Check it, then publish it.' })).toBeVisible();
  const imported = other.getByRole('region', { name: 'Design' });
  await expect(imported.getByLabel('Design preset')).toHaveValue('playful-school');
  await expect(imported.getByLabel('Brand colour')).toHaveValue('#0F766E');
  await expect(imported.getByText('Draft saved, not live yet')).toBeVisible();
  // Not live for that school until published.
  expect(await style(other, 'header.app-header', 'background-color')).not.toBe('rgb(15, 118, 110)');

  // A settings file of the wrong kind is refused.
  const people = other.getByRole('region', { name: 'People and sign-in' });
  await people.getByText('Export or import').click();
  await people.getByLabel('Settings file (.json)').setInputFiles(file);
  await people.getByRole('button', { name: 'Import as draft' }).click();
  await expect(people.getByText('That file holds a different kind of settings.')).toBeVisible();
  // So is a file that is not a settings file at all.
  await people.getByLabel('Settings file (.json)').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello": 1}') });
  await people.getByRole('button', { name: 'Import as draft' }).click();
  await expect(people.getByText('That is not a Sessional settings file.')).toBeVisible();
  await other.context().close();
});

test('only people who may edit settings can download them', async ({ browser }) => {
  const visitor = await (await browser.newContext()).newPage();
  const res = await visitor.goto(at('theta', '/settings/export/theme'));
  expect(res!.status()).toBe(403);
  const unknown = await visitor.goto(at('theta', '/settings/export/nonsense'));
  expect(unknown!.status()).toBe(404);
  await visitor.context().close();
});

test('the email preview uses the saved design, with nothing able to run', async ({ page }) => {
  await openSettings(page, 'theta');
  const frame = page.locator('iframe[title="How emails will look"]');
  await expect(frame).toHaveAttribute('sandbox', '');
  const doc = await frame.getAttribute('srcdoc');
  expect(doc).toContain('You are invited to Advanced School');
  expect(doc).toContain('Accept invitation');
  expect(doc).not.toContain('var(');
  // The saved draft has brand #0F766E; the button uses it.
  expect(doc).toContain('background:#0F766E');
  await expect(frame.contentFrame().getByRole('link', { name: 'Accept invitation' })).toBeVisible();
});
