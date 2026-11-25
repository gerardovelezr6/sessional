import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Phase 17: an automated WCAG 2.2 AA audit (axe) of the pages people use most, as each kind of
// person sees them, in the normal look and with the personal high-contrast and larger-text modes.
// Automated checks find about half of the problems; the rest are walked by hand (docs/ACCESSIBILITY.md).

const PORT = 3100;
const at = (host: string, path = '/') => `http://${host}:${PORT}${path}`;

async function audit(page: Page, name: string) {
  await page.waitForLoadState('networkidle');
  // An audit of a "not found" page would prove nothing.
  await expect(page.getByRole('heading', { level: 1, name: /There is no conference here|not found|can’t find/i }), `${name} exists`).toHaveCount(0);
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const found = result.violations.map((v) => `${v.impact} ${v.id}: ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  expect.soft(found, `${name} (${page.url()})`).toEqual([]);
}

async function signIn(page: Page, host: string, email: string) {
  await page.goto(at(host, '/login'));
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login'));
}

const ROOT = [
  ['the home page', '/'],
  ['signup', '/signup'],
  ['the changelog', '/changelog'],
  ['the gallery', '/gallery'],
  ['the privacy policy', '/privacy'],
  ['the status page', '/status'],
  ['the home page in Spanish', '/?lang=es'],
] as const;

for (const mode of ['normal', 'high contrast and larger text'] as const) {
  test.describe(`${mode}`, () => {
    test.beforeEach(async ({ context }) => {
      if (mode !== 'normal') await context.addCookies([{ name: 's_display', value: 'contrast,large', domain: 'localhost', path: '/' }, ...['alpha', 'console', 'grades', 'open', 'screens', 'site', 'admin'].map((h) => ({ name: 's_display', value: 'contrast,large', domain: `${h}.localhost`, path: '/' }))]);
    });

    test('the main website', async ({ page }) => {
      for (const [name, path] of ROOT) {
        await page.goto(at('localhost', path));
        await audit(page, name);
      }
    });

    test('signed-out school pages: sign-in, forgot password, public pages, projection pairing', async ({ page }) => {
      await page.goto(at('alpha.localhost', '/login'));
      await audit(page, 'sign-in');
      await page.goto(at('alpha.localhost', '/forgot'));
      await audit(page, 'forgot password');
      await page.goto(at('open.localhost', '/public'));
      await audit(page, 'public pages');
      await page.getByRole('link', { name: /Human Rights Council/ }).first().click();
      await audit(page, 'a public committee page');
      await page.goto(at('screens.localhost', '/display'));
      await audit(page, 'projection pairing');
    });

    test('an owner’s pages', async ({ page }) => {
      await signIn(page, 'alpha.localhost', 'owner@alpha.test');
      for (const [name, path] of [
        ['home', '/'],
        ['committees', '/committees'],
        ['people', '/people'],
        ['owner area', '/owner'],
        ['settings', '/settings'],
        ['design settings', '/settings?section=theme'],
        ['help', '/help'],
        ['community gallery', '/owner/gallery'],
      ] as const) {
        await page.goto(at('alpha.localhost', path));
        await audit(page, name);
      }
    });

    test('a chair’s console', async ({ page }) => {
      await signIn(page, 'console.localhost', 'chair@console.test');
      await page.goto(at('console.localhost', '/committees/00000000-0000-4000-9000-000000000001'));
      await audit(page, 'committee');
      await page.goto(at('console.localhost', '/committees/00000000-0000-4000-9000-000000000001/console'));
      await audit(page, 'console');
    });

    test('the admin console', async ({ page }) => {
      await signIn(page, 'admin.localhost', 'root@platform.test');
      for (const [name, path] of [
        ['schools', '/'],
        ['plans', '/plans'],
        ['gallery review', '/gallery'],
        ['inbox', '/inbox'],
        ['support', '/support'],
      ] as const) {
        await page.goto(at('admin.localhost', path));
        await audit(page, name);
      }
    });

    test('grading', async ({ page }) => {
      await signIn(page, 'grades.localhost', 'owner@grades.test');
      await page.goto(at('grades.localhost', '/committees/00000000-0000-4000-9200-000000000001?tab=grades'));
      await expect(page.getByRole('table', { name: 'Standings' })).toBeVisible();
      await audit(page, 'gradebook');
    });
  });
}

test('the personal display modes: chosen from the account menu, kept, and applied before the page shows', async ({ page }) => {
  await page.goto(at('alpha.localhost', '/login'));
  const html = page.locator('html');
  await expect(html).not.toHaveAttribute('data-contrast', 'more');
  const size = () => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  expect(await size()).toBe(16);
  await page.getByRole('button', { name: 'Language and display' }).click();
  await page.getByRole('checkbox', { name: 'High contrast' }).check();
  await expect(html).toHaveAttribute('data-contrast', 'more');
  // The menu stays open for the next choice.
  await page.getByRole('checkbox', { name: 'Larger text' }).check();
  await expect(html).toHaveAttribute('data-text', 'large');
  expect(await size()).toBe(20);
  // In the first HTML, so nothing flashes.
  const first = await page.evaluate(() => fetch('/login').then((r) => r.text()));
  expect(first).toMatch(/<html[^>]*data-contrast="more"[^>]*data-text="large"/);
  // Larger text never makes the page scroll sideways on a phone.
  await page.setViewportSize({ width: 375, height: 800 });
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // And it can be turned off again.
  await page.getByRole('button', { name: 'Language and display' }).click();
  await page.getByRole('checkbox', { name: 'High contrast' }).uncheck();
  await expect(html).not.toHaveAttribute('data-contrast', 'more');
});

test('keyboard: the first Tab reaches “Skip to the content”, which moves focus to the page itself', async ({ page }) => {
  await page.goto(at('alpha.localhost', '/login'));
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to the content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
});
