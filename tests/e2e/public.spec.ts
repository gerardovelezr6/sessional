import { createHmac } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

// Phase 11: printables in the school's look, the public pages (whitelisted fields only) and
// checking a delegation in from its placard's QR code.
test.describe.configure({ mode: 'serial' });

const PORT = 3100;
const SC = '00000000-0000-4000-9600-000000000001';
const BRAZIL = '00000000-0000-4000-9600-0000000000d1';
const at = (path = '/') => `http://pub.localhost:${PORT}${path}`;

async function signIn(page: Page, email: string) {
  await page.goto(at('/login'));
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}

// A request from the page (the browser resolves the school's address; Node does not).
async function get(page: Page, path: string) {
  return page.evaluate(async (url) => {
    const res = await fetch(url, { redirect: 'manual' });
    const head = res.type === 'opaqueredirect' ? '' : new TextDecoder().decode((await res.arrayBuffer()).slice(0, 5));
    return { status: res.status, type: res.type, contentType: res.headers.get('content-type'), head };
  }, path);
}

// The code a placard carries, signed as the server signs it (the test server's key).
function checkinCode(committee: string, delegate: string) {
  const key = createHmac('sha256', 'test-service-role-key').update('sessional:checkin:v1').digest('base64');
  return `${committee}.${delegate}.${createHmac('sha256', key).update(`${committee}:${delegate}`).digest('base64url').slice(0, 22)}`;
}

test('High Command prints placards, sign-in sheets, the agenda, resolutions and certificates as PDFs', async ({ page }) => {
  await signIn(page, 'owner@pub.test');
  await page.goto(at('/admin'));
  await page.getByRole('navigation', { name: 'Administration' }).getByRole('link', { name: 'Print' }).click();
  for (const name of ['Placards', 'Sign-in sheets', 'Agenda', 'Resolutions', 'Certificates', 'Grade report']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  for (const path of ['/print/placards?committee=all', `/print/signin?committee=${SC}&sessions=3`, '/print/agenda', '/print/resolutions?committee=all', '/print/certificates?type=participation&committee=all']) {
    expect(await get(page, path), path).toEqual({ status: 200, type: 'basic', contentType: 'application/pdf', head: '%PDF-' });
  }
  // The grade report is the gradebook export.
  expect((await get(page, '/print/grades')).type).toBe('opaqueredirect');
  expect((await get(page, '/print/nonsense')).status).toBe(404);
});

test('the Owner styles placards and certificates; the PDFs follow', async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page, 'owner@pub.test');
  await page.goto(at('/print'));
  await page.getByRole('link', { name: 'Change how placards and certificates look' }).click();
  const section = page.locator('section#printing');
  await section.getByRole('group', { name: 'Paper size', exact: true }).getByText('Letter', { exact: true }).click();
  await section.getByRole('group', { name: 'Placard style', exact: true }).getByText('Bold', { exact: true }).click();
  await section.getByRole('group', { name: 'Certificate style', exact: true }).getByText('Elegant', { exact: true }).click();
  await section.getByRole('group', { name: 'First signature: name', exact: true }).getByRole('textbox', { name: 'English' }).fill('Dana Ruiz');
  await section.getByRole('button', { name: 'Save and publish' }).click();
  await page.waitForURL(/done=published/);
  // Route handlers keep their own copy of the settings for up to 30 seconds after a publish.
  const sizeOf = () =>
    page.evaluate(async () => {
      const text = new TextDecoder('latin1').decode(await (await fetch('/print/placards?committee=all')).arrayBuffer());
      return text.match(/\/MediaBox \[ ([\d.]+ [\d.]+ [\d.]+ [\d.]+) \]/)?.[1] ?? '';
    });
  await expect.poll(sizeOf, { timeout: 40_000, intervals: [1000, 2000, 5000] }).toBe('0 0 792 612');
  expect((await get(page, '/print/certificates?type=participation&committee=all')).status).toBe(200);
});

test('a chair prints for their committee only, and nobody signed out prints anything', async ({ page, browser }) => {
  await signIn(page, 'chair@pub.test');
  await page.goto(at('/print'));
  await expect(page.getByRole('heading', { name: 'Placards', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Certificates', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Committee').first().locator('option')).toHaveText(['SC · Security Council']);
  expect((await get(page, `/print/placards?committee=${SC}`)).status).toBe(200);
  expect((await get(page, '/print/certificates?type=participation')).status).toBe(403);
  const anon = await (await browser.newContext()).newPage();
  await anon.goto(at('/login'));
  expect((await get(anon, '/print/placards')).status).toBe(401);
  await anon.context().close();
});

test('public pages are off until the Owner turns them on, then show whitelisted fields only', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(at('/public'));
  await expect(visitor.getByText('Pub MUN 2026')).toHaveCount(0);

  await signIn(page, 'owner@pub.test');
  await page.goto(at('/settings?section=publicSite'));
  const section = page.locator('section#publicSite');
  for (const name of ['Public pages', 'Live view']) await section.getByRole('group', { name, exact: true }).getByText('On', { exact: true }).click();
  await section.getByRole('button', { name: 'Save and publish' }).click();
  await page.waitForURL(/done=published/);

  await visitor.goto(at('/public'));
  await expect(visitor.getByRole('heading', { level: 1 })).toHaveText('Pub MUN 2026');
  await expect(visitor.getByRole('listitem').filter({ hasText: 'SC · Security Council' })).toContainText('Space debris');
  // A confidential topic is not shown.
  await expect(visitor.getByRole('listitem').filter({ hasText: 'CC · Crisis Cabinet' })).not.toContainText('Secret plot');
  await expect(visitor.getByText('Opening ceremony')).toBeVisible();

  await visitor.getByRole('link', { name: /SC · Security Council/ }).click();
  await expect(visitor.getByRole('region', { name: 'Delegations' })).toContainText('Brazil');
  await expect(visitor.getByRole('region', { name: 'Passed resolutions' })).toContainText('SC/1');
  await expect(visitor.getByRole('region', { name: 'Passed resolutions' })).not.toContainText('Unfinished draft');
  // Never students' names, anywhere on the public side.
  for (const path of ['/public', `/public/committees/${SC}`]) {
    await visitor.goto(at(path));
    await expect(visitor.locator('body')).not.toContainText('Bea Student');
  }

  await visitor.getByRole('link', { name: 'Follow live' }).first().click();
  await expect(visitor.getByText('Security Council').first()).toBeVisible();
  // Route handlers keep their own copy of the settings for up to 30 seconds after a publish.
  const fetchState = () => visitor.evaluate(async (url) => { const r = await fetch(url); return { status: r.status, body: await r.text() }; }, `/public/committees/${SC}/live/state`);
  await expect.poll(async () => (await fetchState()).status, { timeout: 40_000, intervals: [1000, 2000, 5000] }).toBe(200);
  const got = await fetchState();
  const body = got.body;
  expect(body).toContain('Brazil');
  expect(body).not.toContain('Bea Student');
  expect(JSON.parse(body).realtime).toBeNull();
  await visitor.context().close();
});

test('delegates without accounts reach the public pages and the live view, never a sign-in wall', async ({ page, browser }) => {
  const visitor = await (await browser.newContext()).newPage();
  // The school's own address takes someone signed out to what the school publishes.
  await visitor.goto(at('/'));
  await expect(visitor).toHaveURL(/\/public$/);
  await expect(visitor.getByRole('heading', { level: 1 })).toHaveText('Pub MUN 2026');
  // Staff still find the sign-in page; it points delegates back to the live view.
  await visitor.getByRole('link', { name: 'Sign in' }).click();
  await visitor.getByRole('link', { name: /Following a committee\?/ }).click();
  await expect(visitor).toHaveURL(/\/public$/);
  await visitor.getByRole('listitem').filter({ hasText: 'SC · Security Council' }).getByRole('link', { name: 'Follow live' }).click();
  await expect(visitor).toHaveURL(new RegExp(`/public/committees/${SC}/live$`));
  await visitor.context().close();
  // A chair can share it: the address and a code to scan, from the committee page.
  await signIn(page, 'chair@pub.test');
  await page.goto(at(`/committees/${SC}`));
  await page.getByText('Share the live view with delegates').click();
  await expect(page.getByRole('link', { name: new RegExp(`/public/committees/${SC}/live$`) })).toBeVisible();
});

test('a chair checks a delegation in by scanning its placard; others and forged codes cannot', async ({ page, browser }) => {
  const code = checkinCode(SC, BRAZIL);
  await signIn(page, 'chair@pub.test');
  // Opening the page changes nothing; without a session the chair is told to open one.
  await page.goto(at(`/checkin/${code}`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Check in Brazil');
  await page.getByRole('button', { name: 'Mark as Present', exact: true }).click();
  await expect(page.getByText('Open the session in the console first, then scan again.')).toBeVisible();

  await page.goto(at(`/committees/${SC}/console`));
  await page.getByRole('button', { name: 'Open session 1' }).click();
  await expect(page.getByText('Session 1', { exact: true })).toBeVisible();
  await page.goto(at(`/checkin/${code}`));
  await page.getByRole('button', { name: 'Mark as Present', exact: true }).click();
  await expect(page.getByText('Brazil is marked Present.')).toBeVisible();

  await page.goto(at(`/checkin/${code.slice(0, -2)}xx`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('This code is not valid');

  const other = await (await browser.newContext()).newPage();
  await signIn(other, 'hc@pub.test');
  await other.goto(at(`/checkin/${code}`));
  await expect(other.getByRole('heading', { level: 1 })).toHaveText('Only a chair of this committee can check delegations in');
  await other.context().close();
});
