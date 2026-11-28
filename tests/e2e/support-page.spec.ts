import { expect, test, type Page } from '@playwright/test';

// The main website's support page (help for anything other than signing up), and the check that a
// person, not a program, sends the public forms.
test.describe.configure({ mode: 'serial' });

const PORT = 3100;
const admin = (path = '/') => `http://admin.localhost:${PORT}${path}`;
const fromNewAddress = (page: Page) => page.setExtraHTTPHeaders({ 'x-forwarded-for': `198.51.100.${10 + Math.floor(Math.random() * 200)}` });
const humanPause = (page: Page) => page.waitForTimeout(3100);

async function fill(page: Page) {
  const form = page.locator('main form');
  await form.getByLabel('What it’s about').selectOption('billing');
  await form.getByLabel('Your name').fill('Rosa Paz');
  await form.getByLabel('Your email').fill('rosa@school.test');
  await form.getByLabel('School or conference (optional)').fill('colegio-norte');
  await form.getByLabel('What happened, or what you need').fill('Our invoice shows the wrong school name.');
}

test('the support page is linked from the website and the help center, and files a message for the inbox', async ({ page }) => {
  await fromNewAddress(page);
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByRole('contentinfo').getByRole('link', { name: 'Support' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Support');
  await expect(page.getByText(/Delegates and families: questions about a conference go to the school running it/)).toBeVisible();
  await expect(page.getByRole('group', { name: 'A quick check that you’re a person' })).toBeVisible();
  await fill(page);
  await humanPause(page);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('status')).toContainText('Thanks. We have your message.');
  await expect(page.getByRole('status')).toContainText('from support@sessional.app');

  // The person gets a confirmation from the support address (not the sign-up sender), in the
  // Sessional look; replying to it reaches support.
  const outbox = async () => (await (await page.request.get('http://localhost:3199/__test/outbox?to=rosa%40school.test')).json()) as { from: string; subject: string; text: string; html: string | null; reply_to: string | null }[];
  await expect.poll(async () => (await outbox()).length).toBeGreaterThan(0);
  const ack = (await outbox()).at(-1)!;
  expect(ack.from).toBe('Sessional Support <support@sessional.app>');
  expect(ack.reply_to).toBe('support@sessional.app');
  expect(ack.subject).toBe('We have your message: A plan, a payment or an invoice');
  expect(ack.text).toContain('from support@sessional.app');
  expect(ack.html).toContain('/email/sessional-header.png');

  const adminPage = await (await page.context().browser()!.newContext()).newPage();
  await adminPage.goto(admin('/login'));
  await adminPage.getByLabel('Email').fill('root@platform.test');
  await adminPage.getByLabel('Password').fill('correct-password');
  await adminPage.getByRole('button', { name: 'Sign in' }).click();
  await adminPage.waitForURL((u) => !u.pathname.endsWith('/login'));
  await adminPage.goto(admin('/inbox'));
  await expect(adminPage.getByText('Our invoice shows the wrong school name.')).toBeVisible();
  await adminPage.context().close();
});

test('without the person check the message is not sent, and what was typed stays', async ({ page }) => {
  await fromNewAddress(page);
  await page.goto(`http://localhost:${PORT}/support`);
  await fill(page);
  await page.locator('input[name="cf-turnstile-response"]').evaluate((el) => el.remove());
  await humanPause(page);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('The check that you’re a person didn’t pass. Please try it again.')).toBeVisible();
  await expect(page.getByLabel('Your name')).toHaveValue('Rosa Paz');
});

test('signup also asks for the person check', async ({ page }) => {
  await page.goto(`http://localhost:${PORT}/signup`);
  await expect(page.getByRole('group', { name: 'A quick check that you’re a person' })).toBeVisible();
  await expect(page.locator('input[name="cf-turnstile-response"]')).toHaveValue('turnstile-pass');
});
