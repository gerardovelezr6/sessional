import { readdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// Phase 17: the customer help center, including the High Command and advisor guides, in both
// languages, from the same Markdown files the repository shows.
const ROOT = 'http://localhost:3100';

test('every article exists in both languages, and the list links to each', () => {
  const en = readdirSync('content/help/en').sort();
  const es = readdirSync('content/help/es').sort();
  expect(es).toEqual(en);
  expect(en).toContain('high-command-guide.md');
  expect(en).toContain('advisor-guide.md');
});

test('the help center lists the articles; an article reads in English and Spanish; guides are there', async ({ page }) => {
  await page.goto(`${ROOT}/`);
  await page.getByRole('contentinfo').getByRole('link', { name: 'Help center' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Help center');
  const guides = page.getByRole('region', { name: 'Guides' });
  await expect(guides.getByRole('link')).toHaveText(['Guide for High Command', 'Guide for faculty advisors']);
  const links = page.locator('main a[href^="/help/"]');
  expect(await links.count()).toBe(readdirSync('content/help/en').length);

  await guides.getByRole('link', { name: 'Guide for High Command' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Guide for High Command');
  await expect(page.getByRole('heading', { level: 2, name: 'During the conference' })).toBeVisible();
  await page.getByRole('link', { name: 'Español' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Guía para el Alto Mando');
  await expect(page.getByRole('heading', { level: 2, name: 'Durante la conferencia' })).toBeVisible();

  // Every article opens (no broken one), in both languages.
  for (const file of readdirSync('content/help/en')) {
    for (const lang of ['', '?lang=es']) {
      const res = await page.goto(`${ROOT}/help/${file.replace(/\.md$/, '')}${lang}`);
      expect(res?.status(), `${file} ${lang}`).toBe(200);
    }
  }
  expect((await page.goto(`${ROOT}/help/nothing-here`))?.status()).toBe(404);
});
