import { expect, test, type Page } from '@playwright/test';

// Conference documents: uploaded by the people who run the conference, checked by their first
// bytes, kept in a private store, and shown to staff, to every member, or on the public pages.
test.describe.configure({ mode: 'serial' });

const PORT = 3100;
const MOCK = 'http://localhost:3199';
const docs = (path = '/') => `http://docs.localhost:${PORT}${path}`;
// Fetched from inside the page: the test's own HTTP client can't resolve *.localhost.
const fetchIn = (page: Page, href: string) =>
  page.evaluate(async (u) => {
    const r = await fetch(u);
    return { status: r.status, type: r.headers.get('content-type'), cache: r.headers.get('cache-control'), text: r.ok ? await r.text() : '' };
  }, href);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

async function signIn(page: Page, email: string) {
  await page.goto(docs('/login'));
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}

async function upload(page: Page, name: string, mimeType: string, buffer: Buffer, title: string, audience: string) {
  const add = page.getByRole('region', { name: 'Add a document' });
  await add.locator('input[type=file]').setInputFiles({ name, mimeType, buffer });
  await add.getByRole('textbox', { name: /^Title/ }).fill(title);
  await add.getByRole('radio', { name: new RegExp(`^${audience}`) }).check();
  await add.getByRole('button', { name: 'Upload' }).click();
}

test('the owner uploads documents for staff, members and the public; a disguised file is refused', async ({ page, request }) => {
  await signIn(page, 'owner@docs.test');
  await page.goto(docs('/admin/documents'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Global documents');
  await expect(page.getByText('Nothing uploaded yet.')).toBeVisible();

  // A program renamed to .pdf: its first bytes give it away.
  await upload(page, 'handbook.pdf', 'application/pdf', Buffer.from('MZ not really a pdf'), 'Fake', 'Everyone signed in');
  await expect(page.getByText(/That kind of file can’t be shared here/)).toBeVisible();

  await upload(page, 'handbook.pdf', 'application/pdf', PDF, 'Delegate handbook', 'Everyone signed in');
  await expect(page.getByRole('status')).toHaveText('Document added.');
  await expect(page.getByRole('heading', { name: '1 document' })).toBeVisible();
  await upload(page, 'chairs.pdf', 'application/pdf', PDF, 'Chair notes', 'Staff');
  await expect(page.getByRole('heading', { name: '2 documents' })).toBeVisible();
  await upload(page, 'schedule.txt', 'text/plain', Buffer.from('Opening ceremony at 9:00'), 'Schedule', 'The public pages');
  await expect(page.getByRole('heading', { name: '3 documents' })).toBeVisible();
  expect(await (await request.get(`${MOCK}/__test/documents`)).json()).toHaveLength(3);

  // The file comes back as it went in.
  const res = await fetchIn(page, (await page.getByRole('link', { name: 'Delegate handbook' }).getAttribute('href'))!);
  expect(res.status).toBe(200);
  expect(res.type).toBe('application/pdf');
  expect(res.cache).toContain('no-store');
});

test('a chair sees what is for members, not what is for staff, and cannot reach the staff file', async ({ page, browser }) => {
  const owner = await (await browser.newContext()).newPage();
  await signIn(owner, 'owner@docs.test');
  await owner.goto(docs('/admin/documents'));
  const staffHref = (await owner.getByRole('link', { name: 'Chair notes' }).getAttribute('href'))!;
  await owner.context().close();

  await signIn(page, 'chair@docs.test');
  await page.goto(docs('/documents'));
  await expect(page.getByRole('link', { name: 'Delegate handbook' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Schedule' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Chair notes' })).toHaveCount(0);
  expect((await fetchIn(page, staffHref)).status).toBe(404);
  await page.goto(docs('/admin/documents'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('You do not have access to this page');
});

test('visitors see only public documents on the public pages; removing one deletes its file', async ({ page, browser, request }) => {
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(docs('/public'));
  const section = visitor.getByRole('region', { name: 'Conference documents' });
  await expect(section.getByRole('link', { name: 'Schedule' })).toBeVisible();
  await expect(section.getByRole('link')).toHaveCount(1);
  const href = (await section.getByRole('link', { name: 'Schedule' }).getAttribute('href'))!;
  expect((await fetchIn(visitor, href)).text).toBe('Opening ceremony at 9:00');

  await signIn(page, 'owner@docs.test');
  await page.goto(docs('/admin/documents'));
  const row = page.getByRole('row', { name: /Schedule/ });
  await row.getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('button', { name: 'Remove “Schedule” for good' }).click();
  await expect(page.getByRole('status')).toHaveText('Document removed.');
  expect(await (await request.get(`${MOCK}/__test/documents`)).json()).toHaveLength(2);
  expect((await fetchIn(visitor, href)).status).toBe(404);
  await visitor.context().close();
});
