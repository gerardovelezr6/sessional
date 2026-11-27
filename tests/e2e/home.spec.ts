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
  expect(background).toBe('rgb(255, 255, 255)');
});

test('the favicons, home-screen icons and link preview are the Sessional ones', async ({ page, request }) => {
  await page.goto('/');
  const types: Record<string, string> = { '/favicon.ico': 'image/x-icon', '/icon.svg': 'image/svg+xml', '/apple-touch-icon.png': 'image/png' };
  for (const href of await page.locator('link[rel="icon"], link[rel="apple-touch-icon"]').evaluateAll((els) => els.map((e) => e.getAttribute('href')!))) {
    const res = await request.get(href);
    expect(res.ok()).toBe(true);
    expect(res.headers()['content-type']).toContain(types[href]);
  }
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.theme_color).toBe('#C8175D');
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);
  const preview = await page.locator('meta[property="og:image"]').getAttribute('content');
  expect(preview).toContain('/og/sessional-en.png');
  expect((await request.get(new URL(preview!).pathname)).ok()).toBe(true);
});

test('the landing page lists what Sessional does, in English and Spanish, with no “coming next” list', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("Run every committee of your Model UN from the chair’s laptop.");
  for (const name of ['How a session runs', 'Every screen, from the chair’s console', 'For the people organizing it', 'Your conference, your words', 'Pricing', 'Questions']) {
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  }
  await expect(page.getByRole('heading', { level: 2, name: 'Coming next' })).toHaveCount(0);
  // No billing tables in this database: pricing says so rather than inventing numbers.
  await expect(page.locator('#pricing')).toContainText('Pricing is being finalized');
  await expect(page.locator('#screens').getByRole('figure', { name: 'The chair’s console on a laptop' })).toBeVisible();
  // One main action in the hero; the one bright band near the end.
  await expect(page.locator('#hero-title').locator('..').locator('.btn')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 2, name: 'Running a conference this school year?' })).toBeVisible();

  await page.getByRole('link', { name: 'Español' }).click();
  await expect(page).toHaveURL(/lang=es/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dirige cada comité de tu Modelo de la ONU desde la laptop de la mesa.');
  await expect(page.getByRole('link', { name: 'English' })).toBeVisible();
});

test('the website has its own type (Zodiak, Switzer, Satoshi), served from this site; a school keeps its font', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (r) => {
    if (/fonts\.(googleapis|gstatic)\.com|use\.typekit|fonts\.bunny/.test(r.url())) external.push(r.url());
  });
  await page.goto('/');
  const family = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).fontFamily);
  expect(await family('h1')).toContain('Zodiak');
  expect(await family('main p')).toContain('Switzer');
  expect(await family('.landing-page .font-mono')).toContain('Satoshi');
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family).join(' '));
  expect(loaded).toContain('Zodiak');
  expect(loaded).toContain('Switzer');
  expect(external).toEqual([]);

  // A school's page uses the font from its own theme, not the website's.
  await page.goto('http://alpha.localhost:3100/login');
  expect(await page.locator('body').evaluate((el) => getComputedStyle(el).fontFamily)).not.toContain('Switzer');
});
