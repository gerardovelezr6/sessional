import { expect, test, type Page } from '@playwright/test';

const PORT = 3100;
const at = (host: string, path = '/') => `http://${host}:${PORT}${path}`;
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

async function signIn(page: Page, host: string, email: string, password = 'correct-password') {
  await page.goto(at(host, '/login'));
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // A successful sign-in leaves the login page; wait for that before the test moves on.
  if (password !== 'wrong') await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}

test('signed-out visitors are sent to sign in', async ({ page }) => {
  await page.goto(at('alpha.localhost'));
  await expect(page).toHaveURL(at('alpha.localhost', '/login'));
  await page.goto(at('alpha.localhost', '/people'));
  await expect(page).toHaveURL(at('alpha.localhost', '/login'));
});

test('a wrong password is refused with a clear message', async ({ page }) => {
  await signIn(page, 'alpha.localhost', 'owner@alpha.test', 'wrong');
  await expect(page.locator('p[role="alert"]')).toHaveText('That email or password is not right.');
  await expect(page).toHaveURL(at('alpha.localhost', '/login'));
});

test('an owner signs in, sees their role, and signs out', async ({ page }) => {
  await signIn(page, 'alpha.localhost', 'owner@alpha.test');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('School Alpha');
  await expect(page.getByText('Your role: Owner')).toBeVisible();
  await expect(page.getByText('Welcome, Olivia Owner')).toBeVisible();
  // The header names who is signed in.
  await expect(page.locator('header.app-header')).toContainText('Olivia Owner');

  // Tokens are not readable by page scripts.
  expect(await page.evaluate(() => document.cookie)).toBe('');
  const cookies = await page.context().cookies();
  expect(cookies.filter((c) => c.name.startsWith('s_')).every((c) => c.httpOnly && c.sameSite === 'Lax')).toBe(true);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(at('alpha.localhost', '/login'));
  await page.goto(at('alpha.localhost'));
  await expect(page).toHaveURL(at('alpha.localhost', '/login'));
});

test('a session on one school does not exist on another', async ({ page }) => {
  await signIn(page, 'alpha.localhost', 'owner@alpha.test');
  await expect(page.getByText('Your role: Owner')).toBeVisible();
  await page.goto(at('beta.localhost'));
  await expect(page).toHaveURL(at('beta.localhost', '/login'));
});

test('someone who is not a member gets no access', async ({ page }) => {
  await signIn(page, 'alpha.localhost', 'stranger@else.test');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('No access to this conference');
  await expect(page.getByText('stranger@else.test')).toBeVisible();
  await page.goto(at('alpha.localhost', '/people'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('You do not have access to this page');
});

test('a chair cannot open the people page', async ({ page }) => {
  await signIn(page, 'alpha.localhost', 'chair@alpha.test');
  await expect(page.getByText('Your role: Chair')).toBeVisible();
  await expect(page.getByRole('link', { name: 'People', exact: true })).toHaveCount(0);
  await page.goto(at('alpha.localhost', '/people'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('You do not have access to this page');
});

test('High Command can only grant roles at or below its own', async ({ page }) => {
  await signIn(page, 'alpha.localhost', 'hc@alpha.test');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'People', exact: true }).click();
  await expect(page.getByLabel('Role').locator('option')).toHaveText(['High Command', 'Chair']);
});

test('invitation: link previews do not use it up, it works once, and the person ends up active', async ({ page, browser }) => {
  const email = `new-${unique()}@alpha.test`;
  await signIn(page, 'alpha.localhost', 'owner@alpha.test');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'People', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('People');

  await page.getByLabel('Name').fill('Nadia New');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Role').selectOption('chair');
  await page.getByRole('button', { name: 'Create invitation' }).click();
  await expect(page.getByRole('status')).toContainText(`Copy this link and send it to ${email}`);
  const link = await page.getByLabel('Invitation link').inputValue();
  expect(link).toMatch(/^http:\/\/alpha\.localhost:3100\/set-password\?token_hash=[0-9a-f]+&type=invite$/);

  // The list shows the person as invited, without a manual reload.
  const row = page.getByRole('row').filter({ hasText: email });
  await expect(row).toContainText('Nadia New');
  await expect(row).toContainText('Invited');

  // A chat app or mail scanner opens the link (twice) to build a preview.
  const preview = await browser.newContext();
  for (let i = 0; i < 2; i++) {
    const p = await preview.newPage();
    await p.goto(link);
    await expect(p.getByRole('button', { name: 'Continue' })).toBeVisible();
    await p.close();
  }
  await preview.close();

  // The invited person, on another device.
  const device = await browser.newContext();
  const guest = await device.newPage();
  await guest.goto(link);
  await guest.getByRole('button', { name: 'Continue' }).click();
  await expect(guest.getByRole('heading', { level: 1 })).toHaveText('Choose your password');

  await guest.getByLabel('New password').fill('a-long-password');
  await guest.getByLabel('Repeat the password').fill('different-password');
  await guest.getByRole('button', { name: 'Save password' }).click();
  await expect(guest.locator('p[role="alert"]')).toHaveText('The two passwords do not match.');

  await guest.getByLabel('New password').fill('a-long-password');
  await guest.getByLabel('Repeat the password').fill('a-long-password');
  await guest.getByRole('button', { name: 'Save password' }).click();
  await expect(guest.getByText('Your role: Chair')).toBeVisible();
  await expect(guest.getByText('Welcome, Nadia New')).toBeVisible();

  // The link is spent.
  await guest.getByRole('button', { name: 'Sign out' }).click();
  await guest.goto(link);
  await guest.getByRole('button', { name: 'Continue' }).click();
  await expect(guest.locator('p[role="alert"]')).toContainText('already used or it expired');

  // The new password works.
  await signIn(guest, 'alpha.localhost', email, 'a-long-password');
  await expect(guest.getByText('Your role: Chair')).toBeVisible();
  await device.close();

  // High Command now sees the person as active.
  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: email })).toContainText('Active');
});

test('a new link replaces the old one', async ({ page, browser }) => {
  const email = `again-${unique()}@alpha.test`;
  await signIn(page, 'alpha.localhost', 'owner@alpha.test');
  await page.goto(at('alpha.localhost', '/people'));
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Create invitation' }).click();
  const first = await page.getByLabel('Invitation link').inputValue();

  await page.reload();
  const row = page.getByRole('row').filter({ hasText: email });
  await row.getByRole('button', { name: 'New link' }).click();
  const second = await row.getByLabel('Invitation link').inputValue();
  expect(second).not.toBe(first);

  const device = await browser.newContext();
  const guest = await device.newPage();
  await guest.goto(first);
  await guest.getByRole('button', { name: 'Continue' }).click();
  await expect(guest.locator('p[role="alert"]')).toContainText('already used or it expired');
  await guest.goto(second);
  await guest.getByRole('button', { name: 'Continue' }).click();
  await expect(guest.getByRole('heading', { level: 1 })).toHaveText('Choose your password');
  await device.close();
});

test('inviting someone who already has an account gives them access at once', async ({ page }) => {
  await signIn(page, 'beta.localhost', 'owner@beta.test');
  await page.goto(at('beta.localhost', '/people'));
  await page.getByLabel('Email').fill('chair@alpha.test');
  await page.getByRole('button', { name: 'Create invitation' }).click();
  await expect(page.getByRole('status')).toContainText('already has an account and can sign in now');
  await expect(page.getByLabel('Invitation link')).toHaveValue(at('beta.localhost', '/login'));

  // Inviting the same person again is refused, and says why.
  await page.getByLabel('Email').fill('chair@alpha.test');
  await page.getByRole('button', { name: 'Create invitation' }).click();
  await expect(page.locator('p[role="alert"]')).toHaveText('That person is already here.');
});

test('bad invitation input is refused before anything is created', async ({ page }) => {
  await signIn(page, 'alpha.localhost', 'hc@alpha.test');
  await page.goto(at('alpha.localhost', '/people'));
  // A role above the caller's own, forced past the form.
  await page.getByLabel('Email').fill(`sneaky-${unique()}@alpha.test`);
  await page.getByLabel('Role').evaluate((el: HTMLSelectElement) => {
    el.add(new Option('Owner', 'owner'));
    el.value = 'owner';
  });
  await page.getByRole('button', { name: 'Create invitation' }).click();
  await expect(page.locator('p[role="alert"]')).toHaveText('Choose a role you are allowed to give.');
});

test('a malformed or missing token shows the invalid-link page without calling anything', async ({ page }) => {
  for (const path of ['/set-password', '/set-password?token_hash=short', '/set-password?token_hash=%3Cscript%3E']) {
    await page.goto(at('alpha.localhost', path));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('This link no longer works');
  }
  await page.goto(at('alpha.localhost', '/set-password/new'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('This link no longer works');
});

test('an expiring session is renewed without signing the person out', async ({ page, request }) => {
  await signIn(page, 'alpha.localhost', 'chair@alpha.test');
  await expect(page.getByText('Your role: Chair')).toBeVisible();
  // Swap in a session that expires in 5 seconds (inside the renewal margin).
  const short = await (await request.post('http://localhost:3199/__test/short-session', { data: { email: 'chair@alpha.test' } })).json();
  const jar = page.context();
  const before = (await jar.cookies()).filter((c) => c.name === 's_at' || c.name === 's_rt');
  await jar.addCookies(before.map((c) => ({ ...c, value: c.name === 's_at' ? short.access_token : short.refresh_token })));

  await page.reload();
  await expect(page.getByText('Your role: Chair')).toBeVisible();
  const after = (await jar.cookies()).find((c) => c.name === 's_at');
  expect(after?.value).not.toBe(short.access_token);
});

test('a new school with only the Owner role can add the standard roles in one click', async ({ page }) => {
  await signIn(page, 'gamma.localhost', 'owner@gamma.test');
  await page.goto(at('gamma.localhost', '/people'));
  await expect(page.getByLabel('Role').locator('option')).toHaveText(['Owner']);
  await expect(page.getByRole('heading', { name: 'Add roles for your team' })).toBeVisible();

  await page.getByRole('button', { name: 'Add standard roles' }).click();
  await expect(page.getByLabel('Role').locator('option')).toHaveText(['Owner', 'Advisor', 'High Command', 'Chair']);
  // Chair, the least senior, is preselected, and the prompt is gone.
  await expect(page.getByLabel('Role')).toHaveValue('chair');
  await expect(page.getByRole('heading', { name: 'Add roles for your team' })).toHaveCount(0);
});

test('schools that already have roles are not offered the starter set', async ({ page }) => {
  await signIn(page, 'alpha.localhost', 'owner@alpha.test');
  await page.goto(at('alpha.localhost', '/people'));
  await expect(page.getByRole('button', { name: 'Add standard roles' })).toHaveCount(0);
});
