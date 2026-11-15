import { expect, test } from '@playwright/test';

// The product's privacy policy and terms: public pages on the main address, linked from the home
// page and from the footer of every school page (Google and Microsoft sign-in require them).
const PORT = 3100;

test('the privacy policy and terms are public, in English and Spanish', async ({ page }) => {
  await page.goto(`http://localhost:${PORT}/`);
  // The home page says what the app does, as Google requires.
  await expect(page.getByText(/runs Model United Nations conferences for schools/)).toBeVisible();
  await page.getByRole('navigation', { name: 'Legal' }).getByRole('link', { name: 'Privacy policy' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacy policy');
  await expect(page.getByRole('heading', { name: /^\d+\. Cookies$/ })).toBeVisible();
  await expect(page.getByText(/s_at, s_rt/)).toBeVisible();
  // What Google's reviewers look for: the Google user data section and the Limited Use statement.
  await expect(page.getByRole('heading', { name: /^\d+\. Google user data$/ })).toBeVisible();
  await expect(page.getByText(/adheres to the Google API Services User Data Policy, including the Limited Use requirements/)).toBeVisible();
  // The operator's details come from the hosting settings; until then the page says it is a draft.
  await expect(page.getByRole('note')).toContainText('Draft');
  await page.getByRole('link', { name: 'Leer en español' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Política de privacidad');
  await page.getByRole('link', { name: 'Términos del servicio' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Términos del servicio');
  const res = await page.request.get(`http://localhost:${PORT}/terms`);
  expect(res.status()).toBe(200);
});

test('every school page links to them on the main address', async ({ page }) => {
  await page.goto(`http://alpha.localhost:${PORT}/login`);
  const legal = page.getByRole('navigation', { name: 'Legal' });
  await expect(legal.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', `http://localhost:${PORT}/privacy`);
  await expect(legal.getByRole('link', { name: 'Terms of service' })).toHaveAttribute('href', `http://localhost:${PORT}/terms`);
});
