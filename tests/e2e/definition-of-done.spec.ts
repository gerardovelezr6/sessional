import { expect, test, type Browser, type Page } from '@playwright/test';
import { spanish as es, key, keyPattern, zeroOf } from './support/words';

// Phase 17 acceptance: the brief's definition of done, walked end to end on a brand-new school,
// with no database or code step.
//
//   "A stranger can sign up, name their school, pick a protocol preset and design, invite their
//    team, run a simulated conference with several committees in their own language and style,
//    grade delegates, show a projection screen, export everything, and pay, without me touching
//    the database or the code, and with no trace of PASMUN unless they chose it."
//
// The stranger runs their school in Spanish (every label below is the product's own Spanish, read
// from the catalogs). Recorded: the video is kept in test-results/.
test.describe.configure({ mode: 'serial' });
test.use({ video: 'on' });

const PORT = 3100;
const MOCK = 'http://localhost:3199';
const run = Date.now().toString(36).slice(-5);
const slug = `colegio-hecho-${run}`;
const school = `Colegio Hecho ${run}`;
const at = (path = '/') => `http://${slug}.localhost:${PORT}${path}`;
const owner = { name: 'Dana Directora', email: `dana.${run}@colegio.test` };
const chair = { name: 'Mario Mesa', email: `mario.${run}@colegio.test` };

let page: Page;
const saved = () => expect(page.getByText(zeroOf('console.saving'))).toBeVisible();

async function mailTo(p: Page, email: string, pattern: RegExp): Promise<string> {
  let found = '';
  await expect
    .poll(async () => {
      const mail = (await (await p.request.get(`${MOCK}/__test/outbox?to=${encodeURIComponent(email)}`)).json()) as { text: string }[];
      found = pattern.exec(mail.map((m) => m.text).join('\n'))?.[0] ?? '';
      return found;
    })
    .not.toBe('');
  return found;
}

const noPasmun = async (p: Page, where: string) => expect(await p.content(), where).not.toMatch(/pasmun/i);

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': `203.0.113.${(Number.parseInt(run, 36) % 200) + 20}` } });
  page = await context.newPage();
});

test('1. a stranger signs up and names their school', async () => {
  await page.goto(`http://localhost:${PORT}/`);
  await noPasmun(page, 'website');
  await page.getByRole('link', { name: 'Start a free trial' }).click();
  await page.getByLabel('Your name').fill(owner.name);
  await page.getByLabel('Your email').fill(owner.email);
  await page.getByLabel('School or conference name').fill(school);
  await page.getByLabel(/I’m a teacher/).check();
  await page.getByLabel(/I agree to the/).check();
  await page.waitForTimeout(3100);
  await page.getByRole('button', { name: 'Email me the link' }).click();
  await expect(page.getByRole('status')).toContainText('Check your email.');
  await page.goto(await mailTo(page, owner.email, /https?:\/\/\S+\/signup\/confirm\?\S+/));
  await page.getByLabel('Password', { exact: true }).fill('una contraseña bastante larga');
  await page.getByLabel('Password again').fill('una contraseña bastante larga');
  await page.getByRole('button', { name: 'Create my school' }).click();
  await page.waitForURL(at('/welcome'));
});

test('2. picks their language, design and protocol preset in the setup wizard', async () => {
  await page.getByLabel('Conference name').fill(`Modelo ${run}`);
  await page.getByLabel('Dates').fill('12 al 14 de marzo de 2027');
  await page.getByLabel('Spanish only').check();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.waitForURL(/step=look/);
  // From here on, everything is in Spanish.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(key('welcome.title', { school }));
  await page.getByLabel(es('Classic formal')).check();
  await page.getByRole('button', { name: es('Save and continue') }).click();
  await page.waitForURL(/step=rules/);
  await page.getByLabel(es('Spanish-language rules')).check();
  await page.getByRole('button', { name: es('Save and continue') }).click();
  await page.waitForURL(/step=start/);
  await page.getByRole('button', { name: es('Load the demo') }).click();
  await page.waitForURL(/welcome=demo/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await noPasmun(page, 'home');
});

test('3. invites their team', async ({ browser }) => {
  await page.goto(at('/people'));
  await page.getByRole('button', { name: es('Add standard roles') }).click();
  // The page reloads with the new roles; wait for it before filling the form.
  await expect(page.getByLabel(key('people.role'), { exact: true }).locator('option[value="chair"]')).toHaveCount(1);
  await page.getByLabel(key('people.name')).first().fill(chair.name);
  await page.getByLabel(key('people.email')).first().fill(chair.email);
  await page.getByLabel(key('people.role'), { exact: true }).selectOption('chair');
  await page.getByRole('button', { name: es('Create invitation') }).click();
  await expect(page.getByRole('status')).toContainText(key('people.invite.sent', { email: chair.email }).split('.')[0]!);

  // The chair accepts on their own device, from the email, in Spanish.
  const link = await mailTo(page, chair.email, /http:\/\/\S+\/set-password\?token_hash=\w+&type=invite/);
  const device = await (await browser.newContext()).newPage();
  await device.goto(link);
  await device.getByRole('button', { name: es('Continue') }).click();
  await device.getByLabel(es('New password')).fill('la contraseña de la mesa');
  await device.getByLabel(es('Repeat the password')).fill('la contraseña de la mesa');
  await device.getByRole('button', { name: es('Save password') }).click();
  // Signed in as a chair (a student role), not with the Owner's powers.
  await expect(device.getByText(key('home.role', { role: 'Mesa' }), { exact: false })).toBeVisible();
  await expect(device.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Propietario' })).toHaveCount(0);
  await device.context().close();
});

let committee = '';
test('4. runs a simulated conference with several committees, in Spanish and in their style', async () => {
  // Several committees (the demo's), each ready to run from the home page.
  await page.goto(at('/'));
  const runLinks = page.getByRole('link', { name: key('home.run') });
  expect(await runLinks.count()).toBeGreaterThanOrEqual(3);
  await runLinks.first().click();
  await page.waitForURL(/\/committees\/[0-9a-f-]{36}\/console/);
  committee = /committees\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  await page.getByRole('button', { name: key('console.session.start', { number: 1 }) }).click();
  await saved();
  const groups = page.getByRole('group').filter({ has: page.getByRole('button', { name: 'Presente', exact: true }) });
  const count = Math.min(await groups.count(), 5);
  expect(count).toBeGreaterThanOrEqual(3);
  for (let i = 0; i < count; i++) await groups.nth(i).getByRole('button', { name: 'Presente', exact: true }).click();
  await saved();
  await page.getByRole('tab', { name: key('console.tab.floor') }).click();
  const floor = page.locator('section', { has: page.locator('#floor-title') });
  await floor.getByRole('group', { name: key('floor.add') }).getByRole('button').first().click();
  await saved();
  await floor.getByRole('button', { name: key('floor.next') }).click();
  await saved();
  // The school's style: the classic formal look they picked.
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--s-font-sans'))).toMatch(/serif/i);
  await noPasmun(page, 'console');
});

test('5. shows a projection screen', async ({ browser }) => {
  const screen = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await screen.goto(at('/display'));
  const code = (await screen.getByLabel(key('screen.codeLabel')).innerText()).trim();
  await page.goto(at(`/committees/${committee}/console`));
  await page.getByRole('tab', { name: key('console.tab.screens') }).click();
  const panel = page.locator('section', { has: page.locator('#screens-title') });
  await panel.getByLabel(key('screens.code')).fill(code);
  await panel.getByLabel(key('screens.name')).fill('Auditorio');
  await panel.getByRole('button', { name: key('screens.pair') }).click();
  await expect(panel.getByRole('status')).toHaveText(key('screens.paired'));
  await expect(screen.locator('body')).toContainText(key('screen.generalList'), { timeout: 10_000 });
  await screen.context().close();
});

test('6. grades delegates', async () => {
  await page.goto(at(`/committees/${committee}/console`));
  await page.getByRole('tab', { name: key('console.tab.grading') }).click();
  const panel = page.getByRole('tabpanel', { name: key('console.tab.grading') });
  await panel.getByRole('group', { name: key('grading.who') }).getByRole('button').first().click();
  await panel.getByRole('button', { name: keyPattern('grading.giveLevel') }).first().click();
  await saved();
  await page.goto(at(`/committees/${committee}?tab=grades`));
  await expect(page.getByRole('table', { name: key('grades.standings') }).getByRole('row').nth(1)).toContainText('5');
});

test('7. exports everything', async () => {
  const files = await page.evaluate(async () => {
    const out: Record<string, { status: number; type: string; size: number; text: string }> = {};
    for (const f of ['json', 'csv', 'pdf']) {
      const r = await fetch(`/owner/export?format=${f}`);
      const body = f === 'pdf' ? '' : await r.clone().text();
      out[f] = { status: r.status, type: r.headers.get('content-type') ?? '', size: (await r.arrayBuffer()).byteLength, text: body };
    }
    return out;
  });
  for (const f of ['json', 'csv', 'pdf']) {
    expect(files[f]!.status, f).toBe(200);
    expect(files[f]!.size, f).toBeGreaterThan(500);
  }
  expect(files.json!.text).toContain(school);
  expect(files.json!.text).not.toMatch(/pasmun/i);
});

test('8. pays', async () => {
  await page.goto(at('/owner/billing?currency=usd'));
  const plans = page.getByRole('region', { name: key('billing.plans') });
  await plans.getByRole('listitem', { name: 'Conferencia' }).getByRole('button').first().click();
  await page.waitForURL(/done=paid/);
  await page.reload();
  await expect(page.getByRole('heading', { name: key('billing.current', { plan: 'Conferencia' }) })).toBeVisible();
  await noPasmun(page, 'billing');
});
