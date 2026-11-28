import { expect, test, type Page } from '@playwright/test';

// Phase 14 acceptance: a stranger goes from the website to a working demo conference (recorded),
// and a bot-like burst of signups is throttled. Plus the setup wizard, tours, help and changelog.
test.describe.configure({ mode: 'serial' });

const PORT = 3100;
const MOCK = 'http://localhost:3199';
const run = Date.now().toString(36).slice(-5);
let ip = 0;
const fromNewAddress = (page: Page) => page.setExtraHTTPHeaders({ 'x-forwarded-for': `198.51.100.${(++ip * 37 + Number.parseInt(run, 36)) % 250}` });

async function linkFor(page: Page, email: string): Promise<string> {
  let url = '';
  await expect
    .poll(async () => {
      const mail = (await (await page.request.get(`${MOCK}/__test/outbox?to=${encodeURIComponent(email)}`)).json()) as { text: string }[];
      url = /https?:\/\/\S+\/signup\/confirm\?\S+/.exec(mail.at(-1)?.text ?? '')?.[0] ?? '';
      return url;
    })
    .not.toBe('');
  // The same email in the Sessional look: the header banner, and the link as a button.
  const [last] = ((await (await page.request.get(`${MOCK}/__test/outbox?to=${encodeURIComponent(email)}`)).json()) as { html: string | null }[]).slice(-1);
  expect(last!.html).toContain('/email/sessional-header.png');
  expect(last!.html).toContain(url.replace(/&/g, '&amp;'));
  return url;
}

async function askForSchool(page: Page, who: { name: string; email: string; school: string }) {
  await page.getByLabel('Your name').fill(who.name);
  await page.getByLabel('Your email').fill(who.email);
  await page.getByLabel('School or conference name').fill(who.school);
  await page.getByLabel(/I’m a teacher/).check();
  await page.getByLabel(/I agree to the/).check();
  // People take more than a few seconds; the form ignores anything faster.
  await page.waitForTimeout(3100);
  await page.getByRole('button', { name: 'Email me the link' }).click();
}

// Recorded: the video of each test is kept in test-results/.
test.use({ video: 'on' });

test.describe('a stranger reaches a working demo conference', () => {
  test('from the website to running a committee, in well under 15 minutes', async ({ page }) => {
    const started = Date.now();
    await fromNewAddress(page);
    const email = `stranger.${run}@school.test`;
    const school = `Colegio Prueba ${run}`;
    const slug = `colegio-prueba-${run}`;

    await page.goto('/');
    await page.getByRole('link', { name: 'Start a free trial' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Start a free trial');
    await askForSchool(page, { name: 'Sofía Stranger', email, school });
    await expect(page.getByRole('status')).toContainText('Check your email.');
    // The address was suggested from the name.
    const link = await linkFor(page, email);
    expect(link).not.toContain(email);

    await page.goto(link);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Create ${school}`);
    await expect(page.getByText(`${slug}.localhost:${PORT}`)).toBeVisible();
    await page.getByLabel('Password', { exact: true }).fill('a long enough passphrase');
    await page.getByLabel('Password again').fill('a long enough passphrase');
    await page.getByRole('button', { name: 'Create my school' }).click();

    // Signed in on the school's own address, in the setup wizard.
    await page.waitForURL(`http://${slug}.localhost:${PORT}/welcome`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Set up ${school}`);
    await expect(page.getByRole('listitem').filter({ hasText: '1. Conference' })).toHaveAttribute('aria-current', 'step');
    await page.getByLabel('Conference name').fill(`MUN ${run}`);
    await page.getByLabel('Dates').fill('March 12–14, 2027');
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await page.waitForURL(/step=look/);
    await page.getByLabel('Sessional', { exact: true }).check();
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await page.waitForURL(/step=rules/);
    await page.getByLabel('THIMUN-style').check();
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await page.waitForURL(/step=start/);
    await page.getByRole('button', { name: 'Load the demo' }).click();

    // The demo is there, with a tour for the Owner.
    await page.waitForURL(/welcome=demo/);
    await expect(page.getByRole('status').filter({ hasText: 'The demo conference is ready.' })).toBeVisible();
    const tour = page.getByRole('region', { name: 'Getting started as Owner' });
    await expect(tour).toContainText('Make it yours');
    await tour.getByRole('button', { name: 'Next' }).click();
    await expect(tour).toContainText('Invite your team');
    await tour.getByRole('button', { name: 'Close the tour' }).click();
    await expect(tour).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Finish setting up your school' })).toHaveCount(0);

    // Run a session in the demo's Security Council.
    await page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: 'Security Council' }) }).getByRole('link', { name: 'Run session' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Console: Security Council');
    await page.getByRole('button', { name: 'Open session 1' }).click();
    await expect(page.getByRole('tab', { name: /^Roll call/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText(/15 have not answered yet/)).toBeVisible();

    // The tour stays closed after a reload.
    await page.goto(`http://${slug}.localhost:${PORT}/`);
    await expect(page.getByRole('region', { name: 'Getting started as Owner' })).toHaveCount(0);
    expect(Date.now() - started).toBeLessThan(15 * 60 * 1000);
  });
});

test('a burst of signups from one network is throttled after three', async ({ page }) => {
  await fromNewAddress(page);
  for (const n of [1, 2, 3]) {
    await page.goto('/signup');
    await askForSchool(page, { name: 'Bot', email: `burst.${n}.${run}@school.test`, school: `Burst ${run} ${n}` });
    await expect(page.getByRole('status')).toContainText('Check your email.');
  }
  await page.goto('/signup');
  await askForSchool(page, { name: 'Bot', email: `burst.4.${run}@school.test`, school: `Burst ${run} 4` });
  await expect(page.getByText('Too many signups from your network just now.')).toBeVisible();
});

test('signup checks the address, the adult box, and refuses a used or wrong link', async ({ page }) => {
  await fromNewAddress(page);
  await page.goto('/signup?lang=es');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Empieza una prueba gratis');
  await page.goto('/signup');
  await page.getByLabel('School or conference name').fill('Admin');
  await page.getByLabel('Your address').fill('admin');
  await page.getByLabel('Your name').fill('Ana');
  await page.getByLabel('Your email').fill(`checks.${run}@school.test`);
  await page.getByLabel(/I agree to the/).check();
  await page.waitForTimeout(3100);
  await page.getByRole('button', { name: 'Email me the link' }).click();
  await expect(page.getByText('An adult has to create the school.')).toBeVisible();
  await expect(page.getByLabel(/I’m a teacher/)).toBeFocused();
  await page.getByLabel(/I’m a teacher/).check();
  await page.getByRole('button', { name: 'Email me the link' }).click();
  await expect(page.getByText('That address is reserved. Try another.')).toBeVisible();

  await page.goto(`/signup/confirm?i=00000000-0000-4000-8000-000000000999&h=${'a'.repeat(64)}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('This link doesn’t work anymore');
});

test('help explains each page, brings the tours back, and the changelog is public', async ({ page }) => {
  await page.goto(`http://iota.localhost:${PORT}/login`);
  await page.getByLabel('Email').fill('owner@iota.test');
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login'));
  await page.goto(`http://iota.localhost:${PORT}/import`);
  await page.getByRole('link', { name: 'Help with this page' }).click();
  await expect(page).toHaveURL(/\/help#committees$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Committees and import' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'What’s new' })).toBeVisible();
  // A school that never ran the wizard is reminded; the tour shows until closed or done.
  await page.goto(`http://iota.localhost:${PORT}/`);
  await expect(page.getByRole('heading', { name: 'Finish setting up your school' })).toBeVisible();
  const tour = page.getByRole('region', { name: 'Getting started as Owner' });
  for (let i = 0; i < 4; i++) await tour.getByRole('button', { name: 'Next' }).click();
  await tour.getByRole('button', { name: 'Done' }).click();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Getting started as Owner' })).toHaveCount(0);
  await page.goto(`http://iota.localhost:${PORT}/help`);
  await page.getByRole('button', { name: 'Show the tours again' }).click();
  await page.waitForURL(`http://iota.localhost:${PORT}/`);
  await expect(page.getByRole('region', { name: 'Getting started as Owner' })).toBeVisible();

  await page.goto('/changelog?lang=es');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Novedades');
  await expect(page.getByRole('heading', { level: 2, name: 'Regístrate por tu cuenta' })).toBeVisible();
});
