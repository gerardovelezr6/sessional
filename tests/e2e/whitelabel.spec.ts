import { expect, test, type Page } from '@playwright/test';
import { choose, openSection, saveAndPublish } from './support/settings';

// Phase 15: a school's own domain (checked against live DNS), its emails (words, look, sender),
// white-label on eligible plans only, its legal pages, consent texts and a cookie note.
// Brand School is on the Institution plan; Plain School is on Starter.
test.describe.configure({ mode: 'serial' });

const PORT = 3100;
const MOCK = 'http://localhost:3199';
const at = (host: string, path = '/') => `http://${host}:${PORT}${path}`;
const brand = (path = '/') => at('brand.localhost', path);
const plain = (path = '/') => at('plain.localhost', path);

async function signIn(page: Page, url: string, email: string) {
  await page.goto(url);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login'));
}
const publish = (page: Page, name: string, type: string, data: string) => page.request.post(`${MOCK}/__test/dns`, { data: { name, type, data } });
const outbox = async (page: Page, to: string) => (await (await page.request.get(`${MOCK}/__test/outbox?to=${encodeURIComponent(to)}`)).json()) as { from: string; subject: string; text: string; html: string | null; reply_to: string | null }[];

test('a custom domain: the guidance matches a live DNS check, then it verifies and becomes the main address', async ({ page, browser }) => {
  await signIn(page, brand('/login'), 'owner@brand.test');
  await page.goto(brand('/owner'));
  await page.getByRole('link', { name: 'Domains', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Domains');
  const form = page.getByRole('region', { name: 'Add a domain' });

  // Mistakes are explained before anything is created.
  await form.getByLabel('Domain').fill('not a domain');
  await form.getByRole('button', { name: 'Add domain' }).click();
  await expect(page.getByText('That doesn’t look like a domain.')).toBeVisible();
  await form.getByLabel('Domain').fill('someone.localhost');
  await form.getByRole('button', { name: 'Add domain' }).click();
  await expect(page.getByText('That’s a Sessional address already')).toBeVisible();

  await form.getByLabel('Domain').fill('https://MUN.brand.test/');
  await form.getByRole('button', { name: 'Add domain' }).click();
  await expect(page.getByRole('status')).toHaveText('Domain added. Create the record below, then check.');
  const card = page.getByRole('region', { name: 'mun.brand.test' });
  await expect(card).toContainText('Waiting for DNS');
  await expect(card).toContainText('Create the record below at the company that manages your domain’s DNS.');
  const row = card.getByRole('row').filter({ hasText: 'CNAME' });
  await expect(row).toContainText('mun.brand.test');
  await expect(row).toContainText('cname.vercel-dns.com');
  await expect(row).toContainText('Nothing yet');
  await expect(row).toContainText('Not yet');

  // A record pointing elsewhere is shown as found, and still not a match.
  await publish(page, 'mun.brand.test', 'CNAME', 'old-host.example.net');
  await card.getByRole('button', { name: 'Check now' }).click();
  await expect(page.getByRole('status')).toHaveText('Checked. Not working yet; see the records below.');
  await expect(page.getByRole('region', { name: 'mun.brand.test' }).getByRole('row').filter({ hasText: 'CNAME' })).toContainText('old-host.example.net');

  // Not working yet, so it can't be the main address.
  await expect(page.getByRole('button', { name: 'Make it the main address' })).toHaveCount(0);

  // The record the page asked for: the same live check now agrees, and the domain serves.
  await publish(page, 'mun.brand.test', 'CNAME', 'cname.vercel-dns.com');
  await page.getByRole('region', { name: 'mun.brand.test' }).getByRole('button', { name: 'Check now' }).click();
  await expect(page.getByRole('status')).toHaveText('The domain works.');
  const verified = page.getByRole('region', { name: 'mun.brand.test' });
  await expect(verified).toContainText('Working');
  await expect(verified.getByRole('row').filter({ hasText: 'CNAME' })).toContainText('Matches');
  const visitor = await browser.newPage();
  await visitor.goto(at('mun.brand.test', '/login'));
  await expect(visitor.getByRole('heading', { level: 1 })).toHaveText('Sign in to Brand School');

  // Made the main address: the school's other addresses send people there, the owner included
  // (signing in again, since a sign-in belongs to one address).
  await verified.getByRole('button', { name: 'Make it the main address' }).click();
  await expect(page).toHaveURL(at('mun.brand.test', '/login'));
  await visitor.goto(brand('/login'));
  await expect(visitor).toHaveURL(at('mun.brand.test', '/login'));

  // Back to the Sessional address, from the new main address (a separate sign-in there).
  await signIn(visitor, at('mun.brand.test', '/login'), 'owner@brand.test');
  await visitor.goto(at('mun.brand.test', '/owner/domains'));
  await visitor.getByRole('button', { name: 'Use the Sessional address as main' }).click();
  await expect(visitor.getByRole('status')).toHaveText('Main address changed.');
  await visitor.goto(brand('/login'));
  await expect(visitor).toHaveURL(brand('/login'));
  await visitor.close();
});

test('a domain the hosting provider refuses says why; removing one takes it off', async ({ page }) => {
  await signIn(page, brand('/login'), 'owner@brand.test');
  await page.goto(brand('/owner/domains'));
  await page.getByRole('region', { name: 'Add a domain' }).getByLabel('Domain').fill('mun.blocked.test');
  await page.getByRole('button', { name: 'Add domain' }).click();
  const card = page.getByRole('region', { name: 'mun.blocked.test' });
  await expect(card).toContainText('Problem');
  await expect(card).toContainText('The hosting provider said: The domain is used by another project.');
  await card.getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('button', { name: 'Remove this domain' }).click();
  await expect(page.getByRole('status')).toHaveText('Domain removed.');
  await expect(page.getByRole('region', { name: 'mun.blocked.test' })).toHaveCount(0);
});

test('a plan without them: no domain form, no own sender, and “Powered by Sessional” stays', async ({ page }) => {
  await signIn(page, plain('/login'), 'owner@plain.test');
  await page.goto(plain('/owner/domains'));
  await expect(page.getByText('Your plan doesn’t include your own domain.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Add a domain' })).toHaveCount(0);
  await page.goto(plain('/owner/email'));
  await expect(page.getByText('Your plan doesn’t include sending from your own address.')).toBeVisible();
  await expect(page.getByLabel('Your domain')).toHaveCount(0);

  const section = await openSection(page, 'plain', 'branding');
  await choose(section, '“Powered by Sessional”', 'Off');
  await saveAndPublish(section);
  await page.goto(plain('/login'));
  await expect(page.getByText('Powered by')).toBeVisible();
});

test('white-label on an eligible plan: the mark goes, and the sign-in page has the school’s words', async ({ page, browser }) => {
  await signIn(page, brand('/login'), 'owner@brand.test');
  const visitor = await browser.newPage();
  await visitor.goto(brand('/login'));
  await expect(visitor.getByText('Powered by')).toBeVisible();

  const section = await openSection(page, 'brand', 'branding');
  await choose(section, '“Powered by Sessional”', 'Off');
  await section.locator('#loginTitle\\.en').fill('Brand MUN staff sign-in');
  await section.locator('#loginMessage\\.en').fill('No account? Ask the Secretariat.');
  await saveAndPublish(section);

  await visitor.goto(brand('/login'));
  await expect(visitor.getByText('Powered by')).toHaveCount(0);
  await expect(visitor.getByRole('heading', { level: 1 })).toHaveText('Brand MUN staff sign-in');
  await expect(visitor.getByText('No account? Ask the Secretariat.')).toBeVisible();
  // The legal links stay.
  await expect(visitor.getByRole('navigation', { name: 'Legal' }).getByRole('link', { name: 'Privacy policy' })).toBeVisible();
  await visitor.close();
});

test('the school’s own sender: DNS records shown against a live check, then emails come from it', async ({ page }) => {
  await signIn(page, brand('/login'), 'owner@brand.test');
  await page.goto(brand('/owner/email'));
  await expect(page.getByText('Emails come from Sessional on your behalf')).toBeVisible();
  await page.getByLabel('Name before @').fill('news');
  await page.getByLabel('Your domain').fill('brand.test');
  await page.getByRole('button', { name: 'Use this address' }).click();
  await expect(page.getByRole('status')).toHaveText('Address saved. Create the records below, then check.');
  const dkim = page.getByRole('row').filter({ hasText: 'resend._domainkey.brand.test' });
  await expect(dkim).toContainText('Not yet');
  const value = (await dkim.getByRole('cell').nth(2).textContent())!.trim();

  await publish(page, 'resend._domainkey.brand.test', 'TXT', value);
  await publish(page, 'send.brand.test', 'MX', 'feedback-smtp.us-east-1.amazonses.com');
  await publish(page, 'send.brand.test', 'TXT', 'v=spf1 include:amazonses.com ~all');
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect(page.getByRole('status')).toHaveText('Your domain is verified: emails now come from it.');
  await expect(page.getByText('Emails come from news@brand.test.')).toBeVisible();

  // The school's words for the invitation, previewed and sent as a test.
  const email = await openSection(page, 'brand', 'email');
  await email.locator('#inviteSubject\\.en').fill('Join {school}, {name}');
  await email.getByLabel('Reply-to address').fill('secretariat@brand.test');
  await saveAndPublish(email);
  await page.goto(brand('/owner/email?kind=invite'));
  await expect(page.getByText('Join Brand School, Bree Brand')).toBeVisible();
  await expect(page.frameLocator('iframe[title="Email preview"]').getByRole('link', { name: 'Accept the invitation' })).toBeVisible();
  await page.getByRole('button', { name: 'Send a test to owner@brand.test' }).click();
  await expect(page.getByRole('status')).toHaveText('Test email sent. Check your inbox.');
  const [sent] = (await outbox(page, 'owner@brand.test')).slice(-1);
  expect(sent!.subject).toBe('Join Brand School, Bree Brand');
  expect(sent!.from).toBe('Brand School <news@brand.test>');
  expect(sent!.reply_to).toBe('secretariat@brand.test');
  expect(sent!.html).toContain('Accept the invitation');
});

test('inviting someone emails them the link, from the school', async ({ page }) => {
  const email = `guest-${Date.now()}@brand.test`;
  await signIn(page, brand('/login'), 'owner@brand.test');
  await page.goto(brand('/people'));
  await page.getByLabel('Name').fill('Gale Guest');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Role', { exact: true }).selectOption('chair');
  await page.getByRole('button', { name: 'Create invitation' }).click();
  await expect(page.getByRole('status')).toContainText(`Invitation emailed to ${email}`);
  const link = await page.getByLabel('Invitation link').inputValue();
  const [sent] = await outbox(page, email);
  expect(sent!.subject).toBe('Join Brand School, Gale Guest');
  expect(sent!.text).toContain(link);
});

test('forgot password: the same answer for anyone, and a one-time link by email for members', async ({ page, browser }) => {
  await page.goto(brand('/login'));
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Forgot your password?');
  await page.getByLabel('Email').fill('nobody@nowhere.test');
  await page.getByRole('button', { name: 'Email me a link' }).click();
  await expect(page.getByText('If that address belongs to someone here')).toBeVisible();
  expect(await outbox(page, 'nobody@nowhere.test')).toHaveLength(0);

  await page.goto(brand('/forgot'));
  await page.getByLabel('Email').fill('Chair@Brand.test');
  await page.getByRole('button', { name: 'Email me a link' }).click();
  await expect(page.getByText('If that address belongs to someone here')).toBeVisible();
  const [mail] = await outbox(page, 'chair@brand.test');
  expect(mail!.subject).toBe('Choose a new password for Brand School');
  const link = /http:\/\/brand\.localhost:3100\/set-password\?token_hash=\w+&type=recovery/.exec(mail!.text)![0];

  const device = await (await browser.newContext()).newPage();
  await device.goto(link);
  await device.getByRole('button', { name: 'Continue' }).click();
  await device.getByLabel('New password').fill('a-brand-new-password');
  await device.getByLabel('Repeat the password').fill('a-brand-new-password');
  await device.getByRole('button', { name: 'Save password' }).click();
  await expect(device.getByText('Welcome, Cole Brand')).toBeVisible();
  await device.context().close();

  // A school without its own domain on another plan sends from Sessional, in the school's name.
  await page.goto(plain('/forgot'));
  await page.getByLabel('Email').fill('owner@plain.test');
  await page.getByRole('button', { name: 'Email me a link' }).click();
  await expect(page.getByText('If that address belongs to someone here')).toBeVisible();
  const [fromUs] = await outbox(page, 'owner@plain.test');
  expect(fromUs!.from).toMatch(/^Plain School <.+>$/);
  expect(fromUs!.from).not.toContain('plain.test');
});

test('the school’s own privacy policy and terms, on eligible plans only', async ({ page, browser }) => {
  await signIn(page, brand('/login'), 'owner@brand.test');
  const legal = await openSection(page, 'brand', 'legal');
  await legal.locator('#privacy\\.en').fill('# What we keep\n\nOnly your name and committee.');
  await saveAndPublish(legal);
  const visitor = await browser.newPage();
  await visitor.goto(brand('/login'));
  await visitor.getByRole('navigation', { name: 'Legal' }).getByRole('link', { name: 'Privacy policy' }).click();
  await expect(visitor).toHaveURL(brand('/privacy'));
  await expect(visitor.getByRole('heading', { name: 'What we keep' })).toBeVisible();
  await expect(visitor.getByText('Only your name and committee.')).toBeVisible();
  await expect(visitor.getByText('Sessional runs this site for the school')).toBeVisible();

  // Starter: the text can be written, but Sessional's policy applies.
  await signIn(page, plain('/login'), 'owner@plain.test');
  const theirs = await openSection(page, 'plain', 'legal');
  await theirs.locator('#privacy\\.en').fill('Plain policy');
  await saveAndPublish(theirs);
  await visitor.goto(plain('/login'));
  expect(await visitor.getByRole('navigation', { name: 'Legal' }).getByRole('link', { name: 'Privacy policy' }).getAttribute('href')).toBe(`http://localhost:${PORT}/privacy`);
  await visitor.goto(plain('/privacy'));
  await expect(visitor).toHaveURL(`http://localhost:${PORT}/privacy`);
  await visitor.close();
});

test('consent texts and the cookie note, in the school’s words', async ({ page, browser }) => {
  await signIn(page, brand('/login'), 'owner@brand.test');
  const consent = await openSection(page, 'brand', 'consent');
  await consent.locator('#invite\\.en').fill('By joining you accept the Brand MUN code of conduct.');
  await choose(consent, 'Cookie note', 'On');
  await consent.locator('#cookieText\\.en').fill('We use one cookie to keep you signed in.');
  await saveAndPublish(consent);

  // An invitation shows what the person accepts; a password reset doesn't.
  await page.goto(brand('/people'));
  const email = `consent-${Date.now()}@brand.test`;
  await page.getByLabel('Name').fill('Cora Consent');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Role', { exact: true }).selectOption('chair');
  await page.getByRole('button', { name: 'Create invitation' }).click();
  const link = await page.getByLabel('Invitation link').inputValue();

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(link);
  await expect(visitor.getByText('By joining you accept the Brand MUN code of conduct.')).toBeVisible();
  await visitor.goto(link.replace('type=invite', 'type=recovery'));
  await expect(visitor.getByText('By joining you accept')).toHaveCount(0);

  // The cookie note shows until it is closed, and stays closed.
  await visitor.goto(brand('/login'));
  const note = visitor.getByRole('complementary', { name: 'About cookies' });
  await expect(note).toContainText('We use one cookie to keep you signed in.');
  await note.getByRole('button', { name: 'OK' }).click();
  await expect(note).toHaveCount(0);
  await visitor.reload();
  await expect(visitor.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(visitor.getByRole('complementary', { name: 'About cookies' })).toHaveCount(0);
  await visitor.context().close();
});
