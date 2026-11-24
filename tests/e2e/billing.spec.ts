import { expect, test, type Page } from '@playwright/test';

// Phase 13: billing in the app, against the Stripe stand-in in the mock server (the real Stripe
// run is tests/stripe/test-clock.test.ts). Plans, usage and limits, subscribing through Checkout,
// changing and cancelling, read-only, the webhook's signature check, and the admin side.
test.describe.configure({ mode: 'serial' });

const PORT = 3100;
const MOCK = 'http://localhost:3199';
const school = (path = '/') => `http://bill.localhost:${PORT}${path}`;
const admin = (path = '/') => `http://admin.localhost:${PORT}${path}`;
const BILL = '00000000-0000-4000-8000-000000000027';

async function signIn(page: Page, email: string, at = school) {
  await page.goto(at('/login'));
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}

test('a school with no plan is unmetered; a platform admin puts it on a plan with a trial', async ({ page, browser }) => {
  const owner = await (await browser.newContext()).newPage();
  await signIn(owner, 'owner@bill.test');
  await owner.goto(school('/owner/billing'));
  await expect(owner.getByText('Your school is not on a plan: nothing is limited or charged for now.')).toBeVisible();

  await signIn(page, 'root@platform.test', admin);
  await page.goto(admin(`/tenants/${BILL}`));
  const billing = page.getByRole('region', { name: 'Billing' });
  await billing.getByRole('combobox', { name: 'Plan', exact: true }).selectOption('starter');
  await billing.getByLabel('Committees').fill('1');
  await billing.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Billing saved.')).toBeVisible();

  await owner.goto(school('/owner/billing'));
  await expect(owner.getByRole('heading', { name: 'Plan: Starter' })).toBeVisible();
  await expect(owner.getByText(/^Free trial until /)).toBeVisible();
  const usage = owner.getByRole('region', { name: 'What you use' });
  await expect(usage).toContainText('1 of 1');
  await expect(usage).toContainText('At the limit: nothing more can be added.');
  await owner.context().close();
});

test('the database’s refusal at the limit reads as the plan’s limit', async ({ page }) => {
  await signIn(page, 'owner@bill.test');
  await page.goto(school('/committees'));
  const form = page.locator('section', { has: page.getByRole('heading', { name: 'Add a committee' }) });
  await form.getByLabel('Name', { exact: true }).fill('Security Council');
  await form.getByRole('button', { name: 'Add committee' }).click();
  await expect(page.getByText('Your plan allows 1 committees in the current conference.', { exact: false })).toBeVisible();
});

test('subscribing goes through Stripe Checkout; the webhook makes the plan active', async ({ page }) => {
  await signIn(page, 'owner@bill.test');
  await page.goto(school('/owner/billing?currency=usd'));
  const plans = page.getByRole('region', { name: 'Plans' });
  await plans.getByRole('listitem', { name: 'Conference' }).getByRole('button', { name: '$590.00 USD per year' }).click();
  await page.waitForURL(/done=paid/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Plan: Conference' })).toBeVisible();
  await expect(page.getByText(/^Active\. Renews on /)).toBeVisible();
  // The plan's limits now (the goodwill limit on committees set earlier stays, on top of any plan).
  await expect(page.getByRole('region', { name: 'What you use' })).toContainText('0 of 750');
  await expect(page.getByRole('table', { name: 'Invoices' })).toContainText('SESS-0001');
  await expect(page.getByRole('table', { name: 'Invoices' })).toContainText('Paid');
});

test('cancelling: the export is offered first, the name is typed, and it can be taken back', async ({ page }) => {
  await signIn(page, 'owner@bill.test');
  await page.goto(school('/owner/billing'));
  const cancel = page.getByRole('region', { name: 'Cancel' });
  await expect(cancel.getByRole('link', { name: 'Download a full export' })).toHaveAttribute('href', /\/owner\/data$/);
  await cancel.getByLabel(/Type the school's name/).fill('wrong');
  await cancel.getByRole('button', { name: 'Cancel at the end of the period' }).click();
  await expect(page.getByText('The name does not match.')).toBeVisible();
  await cancel.getByLabel(/Type the school's name/).fill('Bill School');
  await cancel.getByRole('button', { name: 'Cancel at the end of the period' }).click();
  await expect(page.getByText('Cancelled at the end of the period.')).toBeVisible();
  await expect(page.getByText(/^Cancelled: active until /)).toBeVisible();
  await page.getByRole('region', { name: 'Cancel' }).getByRole('button', { name: 'Keep the plan' }).click();
  await page.getByRole('button', { name: 'Take back the cancellation' }).click();
  await expect(page.getByText('The cancellation is taken back.')).toBeVisible();
});

test('read-only: everyone is told, the people who manage the school get the way out', async ({ page, browser, request }) => {
  await request.post(`${MOCK}/__test/billing-status`, { data: { tenant: BILL, status: 'read_only' } });
  test.setTimeout(150_000);
  await signIn(page, 'owner@bill.test');
  const banner = page.getByRole('complementary', { name: 'Billing' });
  // A school's status is kept 60 seconds per server: wait for it to arrive.
  await expect.poll(async () => {
    await page.reload();
    return banner.count();
  }, { timeout: 75_000, intervals: [2000, 5000] }).toBe(1);
  await expect(banner).toContainText('This school is read-only: choose a plan or pay the open invoice');
  await expect(banner.getByRole('link', { name: 'Open billing' })).toBeVisible();
  const hc = await (await browser.newContext()).newPage();
  await signIn(hc, 'hc@bill.test');
  await expect(hc.getByRole('complementary', { name: 'Billing' })).toContainText('This school is read-only for now');
  await expect(hc.getByRole('complementary', { name: 'Billing' }).getByRole('link')).toHaveCount(0);
  await hc.context().close();
  await request.post(`${MOCK}/__test/billing-status`, { data: { tenant: BILL, status: 'active' } });
});

test('the webhook accepts only Stripe-signed events; the daily job needs its secret', async ({ request }) => {
  const res = await request.post(`http://localhost:${PORT}/api/stripe/webhook`, { data: { id: 'evt_x', type: 'invoice.paid', data: { object: {} } }, headers: { 'stripe-signature': 't=1,v1=00' } });
  expect(res.status()).toBe(400);
  expect((await request.get(`http://localhost:${PORT}/api/cron/billing`)).status()).toBe(401);
  const ok = await request.get(`http://localhost:${PORT}/api/cron/billing`, { headers: { authorization: 'Bearer cron-test-secret' } });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toMatchObject({ reconciled: 1 });
});

test('the admin console: plans as data, referral partners, billing overview', async ({ page }) => {
  await signIn(page, 'root@platform.test', admin);
  await page.getByRole('navigation', { name: 'Admin console' }).getByRole('link', { name: 'Plans' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Plans');
  await expect(page.getByText('Every price exists in Stripe.')).toBeVisible();
  await page.getByText('Starter · starter').click();
  const starter = page.locator('details[open]');
  await starter.getByLabel('Committees').fill('8');
  await starter.getByRole('button', { name: 'Save plan' }).click();
  await expect(page.getByText('Plan saved.')).toBeVisible();

  await page.goto(admin('/billing'));
  await page.getByRole('textbox', { name: 'Code' }).fill('circuit10');
  await page.getByRole('textbox', { name: 'Partner' }).fill('MUN Circuit North');
  await page.getByRole('button', { name: 'Add partner' }).click();
  await expect(page.getByText('Partner saved.')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Referral partners' })).toContainText('CIRCUIT10');
  await expect(page.getByRole('region', { name: 'Schools by billing status' })).toContainText('active');
});
