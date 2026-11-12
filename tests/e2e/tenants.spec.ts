import { expect, test } from '@playwright/test';

const PORT = 3100;
const at = (host: string, path = '/') => `http://${host}:${PORT}${path}`;

test('a tenant subdomain shows that tenant', async ({ page }) => {
  const res = await page.goto(at('alpha.localhost'));
  expect(res?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('School Alpha');
  await expect(page).toHaveTitle('School Alpha');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  // The internal path never shows in the address bar.
  expect(new URL(page.url()).pathname).toBe('/');
});

test('two subdomains show two different tenants', async ({ page }) => {
  await page.goto(at('beta.localhost'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('School Beta');
});

test('a verified customer domain shows its tenant', async ({ page }) => {
  await page.goto(at('mun.example.test'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('School Alpha');
});

test('an unknown subdomain or domain is a 404', async ({ page }) => {
  for (const host of ['nobody.localhost', 'unknown.example.test']) {
    const res = await page.goto(at(host));
    expect(res?.status(), host).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('There is no conference here');
  }
});

test('an old address redirects to the new one', async ({ page }) => {
  await page.goto(at('beta-old.localhost'));
  await expect(page).toHaveURL(at('beta.localhost'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('School Beta');
});

test('a suspended tenant shows nothing of itself', async ({ page }) => {
  await page.goto(at('frozen.localhost'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('This conference is not available');
  await expect(page.getByText('Frozen School')).toHaveCount(0);
});

test('the path cannot reach another tenant', async ({ page }) => {
  // From the marketing host: the internal path is hidden.
  expect((await page.goto(at('localhost', '/t/alpha')))?.status()).toBe(404);
  // From one tenant to another.
  const res = await page.goto(at('alpha.localhost', '/t/beta'));
  expect(res?.status()).toBe(404);
  await expect(page.getByText('School Beta')).toHaveCount(0);
});

test('reserved and malformed hosts are a 404', async ({ page }) => {
  for (const host of ['admin.localhost', 'app.localhost', 'a.b.localhost']) {
    expect((await page.goto(at(host)))?.status(), host).toBe(404);
  }
});

test('the service-role key never reaches the browser', async ({ page }) => {
  const bodies: string[] = [];
  page.on('response', async (r) => {
    if (r.url().includes(`:${PORT}`)) bodies.push(await r.text().catch(() => ''));
  });
  await page.goto(at('alpha.localhost'));
  await page.waitForLoadState('networkidle');
  expect(bodies.join('\n')).not.toContain('test-service-role-key');
});
