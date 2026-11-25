import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// Phase 12: the control plane on the admin host. Impersonation needs a reason, shows a banner,
// expires, and appears in the school's audit log; anyone but a platform admin gets a 404.
test.describe.configure({ mode: 'serial' });

const PORT = 3100;
const MOCK = 'http://localhost:3199';
const admin = (path = '/') => `http://admin.localhost:${PORT}${path}`;
const school = (path = '/') => `http://ctl.localhost:${PORT}${path}`;
const CTL = '00000000-0000-4000-8000-000000000026';

async function adminSignIn(page: Page, email = 'root@platform.test') {
  await page.goto(admin('/login'));
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (email === 'root@platform.test') await expect(page.getByRole('heading', { level: 1 })).toHaveText('Schools');
}
async function schoolSignIn(page: Page, email: string) {
  await page.goto(school('/login'));
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}
const notFound = (page: Page) => expect(page.getByRole('heading', { level: 1 })).toHaveText('There is no conference here');

test('anyone but a platform admin gets a 404 on the admin host', async ({ page }) => {
  for (const path of ['/', '/flags', `/tenants/${CTL}`, '/support']) {
    await page.goto(admin(path));
    await notFound(page);
  }
  const res = await page.goto(admin('/'));
  expect(res?.status()).toBe(404);
  // A school's owner cannot sign in here, and is told nothing more than for a wrong password.
  await adminSignIn(page, 'owner@ctl.test');
  await expect(page.getByText('That email or password is not right.')).toBeVisible();
  await page.goto(admin('/'));
  await notFound(page);
  expect(await page.evaluate(async (id) => (await fetch(`/tenants/${id}/diagnostics`)).status, CTL)).toBe(404);
});

test('a platform admin sees every school with its usage and health', async ({ page }) => {
  await adminSignIn(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Schools');
  await page.getByLabel('Name or address').fill('ctl');
  await page.getByRole('button', { name: 'Find' }).click();
  const row = page.getByRole('table', { name: 'Schools' }).getByRole('row', { name: /Control School/ });
  await expect(row).toContainText('Active');
  await expect(row).toContainText(/\d+ · (good|watch|at risk)/);
  await row.getByRole('link', { name: 'Control School' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Control School');
  await expect(page.getByRole('region', { name: 'Overview' })).toContainText('Invitations pending');
  // The diagnostic bundle: counts and actions, no email addresses.
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download diagnostic bundle' }).click();
  const bundle = readFileSync(await (await download).path(), 'utf8');
  expect(JSON.parse(bundle)).toMatchObject({ format: 'sessional-diagnostics', tenant: { slug: 'ctl' } });
  expect(bundle).not.toMatch(/@ctl\.test|Olive|Chad/);
});

test('impersonation needs a reason, shows a banner and is in the school’s audit log', async ({ page, browser }) => {
  await adminSignIn(page);
  await page.goto(admin(`/tenants/${CTL}`));
  const members = page.getByRole('region', { name: 'Members' });
  // Someone who has never signed in cannot be chosen.
  await expect(members.getByText('Sign in as Ivy Invited…')).toHaveCount(0);
  await members.getByText('Sign in as Olive Control…').click();
  const form = members.locator('details[open]');
  await form.getByLabel('Reason (at least 10 characters, shown to the school)').fill('short');
  // The browser asks for 10 characters first; the server says the same if that is bypassed.
  await form.getByLabel('Reason (at least 10 characters, shown to the school)').evaluate((el) => el.removeAttribute('minlength'));
  await form.getByRole('button', { name: 'Sign in as this member' }).click();
  await expect(page.getByText('Give a reason of at least 10 characters.')).toBeVisible();
  await form.getByLabel('Reason (at least 10 characters, shown to the school)').fill('Owner reports roles page is broken');
  await form.getByLabel('For').selectOption({ label: '15 minutes' });
  await form.getByRole('button', { name: 'Sign in as this member' }).click();

  // On the school's own address, as the owner, with the banner on every page.
  await page.waitForURL(/ctl\.localhost/);
  const banner = page.getByRole('alert').filter({ hasText: 'Platform support' });
  await expect(banner).toContainText('Platform support (root@platform.test) is signed in as Olive Control');
  await expect(banner).toContainText('Reason: Owner reports roles page is broken');
  await page.goto(school('/people/roles'));
  await expect(banner).toBeVisible();

  // (Changes made now carry the admin: proven against the database in tests/db/control_plane.test.ts.)
  await page.goto(school('/people/audit'));
  const log = page.getByRole('table', { name: 'Audit log' });
  await expect(log.getByRole('row', { name: /Started a support session/ })).toContainText('Platform support');

  await banner.getByRole('button', { name: 'End support session' }).click();
  await page.waitForURL(/admin\.localhost/);
  await expect(page.getByRole('region', { name: 'Support sessions' })).toContainText('Owner reports roles page is broken');
  await expect(page.getByRole('region', { name: 'Support sessions' })).toContainText('ended');

  // The school sees the start and the end in its own audit log.
  const owner = await (await browser.newContext()).newPage();
  await schoolSignIn(owner, 'owner@ctl.test');
  await owner.goto(school('/people/audit'));
  const ownerLog = owner.getByRole('table', { name: 'Audit log' });
  await expect(ownerLog.getByRole('row', { name: /Started a support session/ })).toContainText('Olive Control');
  await expect(ownerLog.getByRole('row', { name: /Ended a support session/ })).toContainText('Platform support');
  await expect(owner.getByRole('alert').filter({ hasText: 'Platform support' })).toHaveCount(0);
  await owner.context().close();
});

test('an impersonation expires: the session stops counting and the banner says so', async ({ page, request }) => {
  await adminSignIn(page);
  await page.goto(admin(`/tenants/${CTL}`));
  const members = page.getByRole('region', { name: 'Members' });
  await members.getByText('Sign in as Chad Control…').click();
  await members.locator('details[open]').getByLabel('Reason (at least 10 characters, shown to the school)').fill('Chair cannot open the console');
  await members.locator('details[open]').getByRole('button', { name: 'Sign in as this member' }).click();
  await page.waitForURL(/ctl\.localhost/);
  await expect(page.getByRole('alert').filter({ hasText: 'Platform support' })).toContainText('signed in as Chad Control');

  await request.post(`${MOCK}/__test/expire-impersonations`);
  await page.goto(school('/dashboard'));
  await expect(page.getByRole('alert').filter({ hasText: 'support session' })).toContainText('This support session has ended.');
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await page.waitForURL(/admin\.localhost/);
  await expect(page.getByRole('region', { name: 'Support sessions' })).toContainText('expired');
});

test('suspending needs a reason and is in the school’s audit log; lifting it restores the status', async ({ page }) => {
  await adminSignIn(page);
  await page.goto(admin(`/tenants/${CTL}`));
  const status = page.getByRole('region', { name: 'Suspend or delete' });
  await status.getByLabel('Reason (noted in the school’s audit log)').first().fill('Unpaid invoice 2026-11');
  await status.getByRole('button', { name: 'Suspend' }).click();
  await expect(page.getByText('Suspended.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 }).locator('..')).toContainText('Suspended');
  await expect(page.getByRole('region', { name: 'Recent activity (actions only)' })).toContainText('platform.suspend · by platform support');
  await status.getByLabel('Reason (noted in the school’s audit log)').first().fill('Paid on 2026-11-24');
  await status.getByRole('button', { name: 'Lift the suspension' }).click();
  await expect(page.getByText('Suspension lifted.')).toBeVisible();
  // Deleting needs the address typed.
  await status.getByLabel('Type ctl to confirm').fill('wrong');
  await status.getByLabel('Reason (noted in the school’s audit log)').last().fill('Testing the guard');
  await status.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('The address typed does not match.')).toBeVisible();
});

test('flags, announcements and presets reach the schools', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await adminSignIn(page);
  // Importing off for this school only.
  await page.goto(admin(`/tenants/${CTL}`));
  const flags = page.getByRole('region', { name: 'Flags for this school' });
  await flags.getByLabel('Importing delegations here').selectOption('off');
  await flags.getByRole('listitem').filter({ hasText: 'Importing delegations' }).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Flag saved.')).toBeVisible();
  // An announcement for every school.
  await page.goto(admin('/announcements'));
  await page.getByLabel('Message in English').fill('Maintenance tonight at 22:00 UTC.');
  await page.getByLabel('Kind').selectOption('warning');
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Announcement published.')).toBeVisible();
  // A design preset, published.
  await page.goto(admin('/presets'));
  const pack = { format: 'sessional-pack', version: 1, kind: 'theme', schemaVersion: 1, exportedAt: '2026-11-24T00:00:00Z', data: { preset: 'flat-institutional', brand: '#123456' } };
  await page.getByLabel('Pack file').setInputFiles({ name: 'navy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(pack)) });
  await page.getByLabel('Name in English').fill('Navy');
  await page.getByRole('button', { name: 'Upload (not published yet)' }).click();
  await expect(page.getByText('Presets updated.')).toBeVisible();
  await page.getByRole('list', { name: 'Presets' }).getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByRole('list', { name: 'Presets' })).toContainText('published');

  const owner = await (await browser.newContext()).newPage();
  await schoolSignIn(owner, 'owner@ctl.test');
  // Kept 30 seconds per server: wait for it to arrive.
  await expect.poll(async () => {
    await owner.goto(school('/'));
    return owner.getByText('Maintenance tonight at 22:00 UTC.').count();
  }, { timeout: 40_000, intervals: [2000, 5000] }).toBe(1);
  await expect.poll(async () => {
    await owner.goto(school('/import'));
    return owner.getByRole('heading', { level: 1 }).textContent();
  }, { timeout: 40_000, intervals: [2000, 5000] }).toBe('Not available right now');
  await owner.goto(school('/settings?section=theme'));
  await owner.getByText('History and files', { exact: true }).click();
  await owner.getByRole('button', { name: 'Install Navy as a draft' }).click();
  await expect(owner.getByText('Imported as a draft. Check it, then publish it.')).toBeVisible();
  await owner.context().close();

  // Tidy up: the announcement and the preset would show on every school in later tests.
  await page.goto(admin('/announcements'));
  await page.getByRole('button', { name: 'End', exact: true }).first().click();
  await page.getByRole('button', { name: 'End this announcement now' }).click();
  await expect(page.getByText('Announcement ended.')).toBeVisible();
  await page.goto(admin('/presets'));
  await page.getByRole('button', { name: 'Unpublish' }).click();
  await expect(page.getByRole('list', { name: 'Presets' })).toContainText('not published');
  await page.goto(admin(`/tenants/${CTL}`));
  await page.getByRole('region', { name: 'Flags for this school' }).getByLabel('Importing delegations here').selectOption('default');
  await page.getByRole('region', { name: 'Flags for this school' }).getByRole('listitem').filter({ hasText: 'Importing delegations' }).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Flag saved.')).toBeVisible();
});

test('support finds a person by exact email, without putting it in the address', async ({ page }) => {
  await adminSignIn(page);
  await page.goto(admin('/support'));
  await page.getByLabel('Email address').fill('chair@ctl.test');
  await page.getByRole('button', { name: 'Find' }).click();
  const found = page.getByRole('region', { name: 'Person found' });
  await expect(found).toContainText('Chad Control');
  await expect(found.getByRole('link', { name: 'Control School' })).toBeVisible();
  expect(page.url()).not.toContain('chair');
});
