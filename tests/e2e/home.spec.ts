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
