import { expect, test } from '@playwright/test';

test('home page shows the wordmark with no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  const wordmark = page.getByRole('img', { name: 'sessional' });
  await expect(wordmark).toBeVisible();
  expect(await wordmark.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  expect(errors).toEqual([]);
});

test('theme tokens arrive in the first HTML response (no flash of defaults)', async ({ request, page }) => {
  const html = await (await request.get('/')).text();
  expect(html).toContain('id="s-tokens"');
  expect(html).toContain('--s-color-surface:');

  await page.goto('/');
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).toBe('rgb(244, 241, 234)');
});

test('the favicon is the supplied app icon', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="icon"]').first().getAttribute('href');
  expect(href).toBeTruthy();
  const res = await request.get(href!);
  expect(res.ok()).toBe(true);
  expect(res.headers()['content-type']).toContain('image/png');
});

test('the landing page lists what Sessional does, in English and Spanish, with no “coming next” list', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("Run every committee of your Model UN from the chair’s laptop.");
  for (const name of ['How a session runs', 'Three screens in the room', 'For the people organizing it', 'Your conference, your words', 'Pricing', 'Questions']) {
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  }
  await expect(page.getByRole('heading', { level: 2, name: 'Coming next' })).toHaveCount(0);
  // No billing tables in this database: pricing says so rather than inventing numbers.
  await expect(page.locator('#pricing')).toContainText('Pricing is being finalized');
  await expect(page.locator('#screens svg').first()).toBeVisible();
  // One main action in the hero; the one bright band near the end.
  await expect(page.locator('#hero-title').locator('..').locator('.btn')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 2, name: 'Running a conference this school year?' })).toBeVisible();

  await page.getByRole('link', { name: 'Español' }).click();
  await expect(page).toHaveURL(/lang=es/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dirige cada comité de tu Modelo de la ONU desde la laptop de la mesa.');
  await expect(page.getByRole('link', { name: 'English' })).toBeVisible();
});

test('the website has its own type (Newsreader, Public Sans, IBM Plex Mono), served from this site; a school keeps its font', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (r) => {
    if (/fonts\.(googleapis|gstatic)\.com|use\.typekit|fonts\.bunny/.test(r.url())) external.push(r.url());
  });
  await page.goto('/');
  const family = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).fontFamily);
  expect(await family('h1')).toContain('Newsreader');
  expect(await family('main p')).toContain('Public Sans');
  expect(await family('.landing-page .font-mono')).toContain('IBM Plex Mono');
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family).join(' '));
  expect(loaded).toContain('Newsreader');
  expect(loaded).toContain('Public Sans');
  expect(external).toEqual([]);

  // A school's page uses the font from its own theme, not the website's.
  await page.goto('http://alpha.localhost:3100/login');
  expect(await page.locator('body').evaluate((el) => getComputedStyle(el).fontFamily)).not.toContain('Public Sans');
});
