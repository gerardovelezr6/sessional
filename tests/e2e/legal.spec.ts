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
  await expect(page.getByRole('heading', { name: /^\d+\. Cookies and similar$/ })).toBeVisible();
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

// Sign-in with Google or Microsoft returns to one fixed address on the main domain, which hands
// the one-time code to the school the sign-in started from, and to nothing else.
test('the sign-in return address forwards a code only to a real school', async ({ request }) => {
  const go = (path: string) => request.get(`http://localhost:${PORT}${path}`, { maxRedirects: 0 });
  const toSchool = await go('/auth/return/people?code=abc&state=x');
  expect(toSchool.status()).toBe(303);
  expect(toSchool.headers().location).toBe(`http://people.localhost:${PORT}/auth/callback?code=abc`);
  const toCustomDomain = await go(`/auth/return/${encodeURIComponent('~mun.example.test')}?code=abc`);
  expect(toCustomDomain.headers().location).toBe('http://mun.example.test/auth/callback?code=abc');
  for (const bad of ['/auth/return/no-such-school?code=abc', `/auth/return/${encodeURIComponent('~evil.example.org')}?code=abc`, '/auth/return/%2F%2Fevil?code=abc']) {
    const res = await go(bad);
    expect(res.status(), bad).toBe(303);
    expect(res.headers().location, bad).toBe(`http://localhost:${PORT}/`);
  }
});

test('a sign-in that lands on the main page without a school says what to do', async ({ page }) => {
  await page.goto(`http://localhost:${PORT}/?error=invalid_request&error_code=flow_state_already_used`);
  await expect(page.getByRole('alert').filter({ hasText: 'Your sign-in did not finish' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Continue with Google' })).toBeVisible();
});

test('a sign-in finished twice explains itself, or simply goes home when already signed in', async ({ page, request }) => {
  // The authentication service reports the reused sign-in; the return address passes it on.
  const res = await request.get(`http://localhost:${PORT}/auth/return/alpha?error=invalid_request&error_code=flow_state_already_used`, { maxRedirects: 0 });
  expect(res.headers().location).toBe(`http://alpha.localhost:${PORT}/auth/callback?error=invalid_request&error_code=flow_state_already_used`);
  await page.goto(`http://alpha.localhost:${PORT}/auth/callback?error=invalid_request&error_code=flow_state_already_used`);
  await expect(page.getByText(/^That sign-in was already used or took too long/)).toBeVisible();
  // Someone already signed in who comes back to an old sign-in page lands on the school's home.
  await page.getByLabel('Email').fill('owner@alpha.test');
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login'));
  await page.goto(`http://alpha.localhost:${PORT}/auth/callback?code=already-used`);
  await expect(page).toHaveURL(`http://alpha.localhost:${PORT}/`);
});

test('the main page explains a sign-in that arrives without a school', async ({ page }) => {
  await page.goto(`http://localhost:${PORT}/?error=invalid_request&error_code=flow_state_already_used`);
  await expect(page.getByRole('heading', { name: 'Your sign-in did not finish' })).toBeVisible();
});
