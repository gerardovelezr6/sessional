import { expect, test, type Browser, type Page } from '@playwright/test';

// People: roles as a permission matrix, a role that only grades, managing people, the audit log,
// password rules, the access code, and sign-in with Google.
test.describe.configure({ mode: 'serial' });

const PORT = 3100;
const COMMITTEE = '00000000-0000-4000-9400-000000000001';
const at = (path = '/') => `http://people.localhost:${PORT}${path}`;

async function signIn(page: Page, email: string) {
  await page.goto(at('/login'));
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}
const fresh = async (browser: Browser) => (await browser.newContext()).newPage();
const matrix = (page: Page) => page.getByRole('table', { name: 'Permissions of each role' });

test('the owner creates a role that only grades, limited to its committees', async ({ page }) => {
  await signIn(page, 'owner@people.test');
  await page.goto(at('/people/roles'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Roles & permissions');
  // The owner column is all ticked and locked.
  await expect(matrix(page).getByRole('checkbox', { name: 'Grade: Owner' })).toBeChecked();
  await expect(matrix(page).getByRole('checkbox', { name: 'Grade: Owner' })).toBeDisabled();

  await page.getByRole('button', { name: 'Add a role' }).click();
  await page.getByLabel('Name, English').fill('Grader');
  await page.getByLabel('Applies to').selectOption({ label: 'Their committees' });
  await matrix(page).getByRole('checkbox', { name: 'Grade: Grader' }).check();
  await page.getByRole('button', { name: 'Save roles' }).click();
  await expect(page.getByText('Roles saved.')).toBeVisible();
  await expect(matrix(page).getByRole('checkbox', { name: 'Grade: Grader' })).toBeChecked();
  await expect(matrix(page).getByRole('checkbox', { name: 'Run committees: Grader' })).not.toBeChecked();
  // Managing committees includes managing delegates: shown ticked and locked.
  await matrix(page).getByRole('checkbox', { name: 'Manage committees: Grader' }).check();
  await expect(matrix(page).getByRole('checkbox', { name: 'Manage delegates: Grader' })).toBeChecked();
  await expect(matrix(page).getByRole('checkbox', { name: 'Manage delegates: Grader' })).toBeDisabled();
  await matrix(page).getByRole('checkbox', { name: 'Manage committees: Grader' }).uncheck();
  await expect(matrix(page).getByRole('checkbox', { name: 'Manage delegates: Grader' })).toBeEnabled();
});

test('a person is given the Grader role; they grade in their committee and can do nothing else', async ({ page, browser }) => {
  await signIn(page, 'owner@people.test');
  await page.goto(at('/people'));
  await page.getByLabel('Role: Hana Helper').selectOption({ label: 'Grader' });
  await page.getByRole('button', { name: 'Change role' }).click();
  await expect(page.getByText('Role changed.')).toBeVisible();

  const helper = await fresh(browser);
  await signIn(helper, 'helper@people.test');
  // No administration in the menu, and no console button on the committee.
  await expect(helper.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveText(['Committees', 'Dashboard']);
  await expect(helper.getByRole('link', { name: 'Run session' })).toHaveCount(0);
  await helper.goto(at(`/committees/${COMMITTEE}?tab=grades`));
  const panel = helper.locator('section', { has: helper.locator('#grading-title') });
  await panel.getByRole('group', { name: 'Delegate' }).getByRole('button', { name: /Brazil/ }).click();
  await panel.getByRole('button', { name: 'Excellent, 5 points, to Brazil' }).click();
  await expect(helper.getByText('Excellent for Brazil.')).toBeVisible();
  // Everything else is closed.
  for (const path of ['/people', '/people/audit', '/settings', '/admin', `/committees/${COMMITTEE}/console`]) {
    await helper.goto(at(path));
    await expect(helper.getByRole('heading', { level: 1 }), path).toHaveText('You do not have access to this page');
  }
  await helper.context().close();
});

test('High Command reads the matrix but cannot change it, and cannot give the Owner role', async ({ page }) => {
  await signIn(page, 'hc@people.test');
  await page.goto(at('/people/roles'));
  await expect(matrix(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save roles' })).toHaveCount(0);
  await page.goto(at('/people'));
  const roles = await page.getByLabel('Role: Lee Leaver').locator('option').allInnerTexts();
  expect(roles).not.toContain('Owner');
  // Nobody senior to them gets controls.
  await expect(page.getByLabel('Role: Pat People')).toHaveCount(0);
});

test('someone is disabled, loses access, is enabled again, then removed', async ({ page, browser }) => {
  await signIn(page, 'owner@people.test');
  await page.goto(at('/people'));
  await page.getByRole('button', { name: 'Disable: Lee Leaver' }).click();
  await expect(page.getByText('Disabled: they can no longer sign in here.')).toBeVisible();
  await page.getByRole('link', { name: /^Disabled/ }).click();
  await expect(page.getByRole('row', { name: /Lee Leaver/ })).toBeVisible();

  const leaver = await fresh(browser);
  await signIn(leaver, 'leaver@people.test');
  await expect(leaver.getByText(/has not been added here/)).toBeVisible();
  await leaver.context().close();

  await page.getByRole('button', { name: 'Enable: Lee Leaver' }).click();
  await expect(page.getByText('Enabled again.')).toBeVisible();
  await page.getByRole('button', { name: 'Remove: Lee Leaver' }).click();
  await page.getByRole('button', { name: 'Yes, remove' }).click();
  await expect(page.getByText('Removed from this school.')).toBeVisible();
  await expect(page.getByRole('row', { name: /Lee Leaver/ })).toHaveCount(0);
});

test('the audit log shows who did what', async ({ page }) => {
  await signIn(page, 'owner@people.test');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Owner' }).click();
  await page.getByRole('navigation', { name: 'Owner menu' }).getByRole('link', { name: 'Audit log' }).click();
  const log = page.getByRole('table', { name: 'Audit log' });
  await expect(log.getByRole('row', { name: /Removed a person.*Lee Leaver|Removed a person/ }).first()).toContainText('Pat People');
  await expect(log.getByText('Added a role').first()).toBeVisible();
  await page.getByRole('navigation', { name: 'Kind of change' }).getByRole('link', { name: 'a role' }).click();
  await expect(log.getByText('Changed a person')).toHaveCount(0);
});

test('the access code: visitors type it first; a wrong code is refused; members pass', async ({ page, browser }) => {
  await signIn(page, 'owner@people.test');
  await page.goto(at('/settings/access'));
  await page.getByLabel('Ask for an access code').check();
  await page.getByLabel('Code', { exact: true }).fill('Open sesame 1');
  await page.getByLabel('Repeat the code').fill('Open sesame 1');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('The new code is in force.')).toBeVisible();

  const visitor = await fresh(browser);
  await visitor.goto(at('/login'));
  await expect(visitor.getByText('Enter the conference access code to continue.')).toBeVisible();
  await expect(visitor.getByLabel('Email')).toHaveCount(0);
  await visitor.getByLabel('Access code').fill('open sesame');
  await visitor.getByRole('button', { name: 'Enter' }).click();
  await expect(visitor.getByText('That code is not right.')).toBeVisible();
  await visitor.getByLabel('Access code').fill('Open sesame 1');
  await visitor.getByRole('button', { name: 'Enter' }).click();
  await expect(visitor.getByLabel('Email')).toBeVisible();
  // The cookie is kept: the next page opens straight away.
  await visitor.goto(at('/login'));
  await expect(visitor.getByLabel('Email')).toBeVisible();
  await visitor.context().close();

  // The signed-in owner was never asked.
  await page.goto(at('/'));
  await expect(page.getByText('Enter the conference access code to continue.')).toHaveCount(0);

  await page.goto(at('/settings/access'));
  await page.getByLabel('Ask for an access code').uncheck();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('No code is asked any more.')).toBeVisible();
});

test('password rules are enforced by the server when someone chooses a password', async ({ page, browser }) => {
  await signIn(page, 'owner@people.test');
  await page.goto(at('/settings?section=people'));
  const people = page.locator('section#people');
  await people.getByText('Upper and lower case, a number and a symbol').click();
  await people.getByRole('button', { name: 'Save and publish' }).click();
  await page.waitForURL(/done=published/);

  await page.goto(at('/people'));
  await page.getByLabel('Email').fill(`newbie-${Date.now().toString(36)}@people.test`);
  await page.getByRole('button', { name: 'Create invitation' }).click();
  const link = await page.getByLabel('Invitation link').inputValue();
  const guest = await fresh(browser);
  await guest.goto(link);
  await guest.getByRole('button', { name: 'Continue' }).click();
  await expect(guest.getByText(/Use upper and lower case letters, a number and a symbol\./)).toBeVisible();
  await guest.getByLabel('New password').fill('Password1!');
  await guest.getByLabel('Repeat the password').fill('Password1!');
  await guest.getByRole('button', { name: 'Save password' }).click();
  await expect(guest.getByText('That password is too common.')).toBeVisible();
  await guest.getByLabel('New password').fill('Blue-Kettle-42');
  await guest.getByLabel('Repeat the password').fill('Blue-Kettle-42');
  await guest.getByRole('button', { name: 'Save password' }).click();
  await guest.waitForURL((u) => !u.pathname.includes('set-password'));
  await guest.context().close();
});

test('sign-in with Google lets an invited person in; an uninvited Microsoft account gets nothing', async ({ page, browser }) => {
  await signIn(page, 'owner@people.test');
  await page.goto(at('/settings?section=people'));
  const people = page.locator('section#people');
  await people.getByRole('group', { name: 'Sign in with Google' }).getByText('On', { exact: true }).click();
  await people.getByRole('group', { name: 'Sign in with Microsoft' }).getByText('On', { exact: true }).click();
  await people.getByRole('button', { name: 'Save and publish' }).click();
  await page.waitForURL(/done=published/);

  const gina = await fresh(browser);
  await gina.goto(at('/login'));
  await gina.getByRole('link', { name: 'Continue with Google' }).click();
  await gina.waitForURL(at('/'));
  await expect(gina.getByText(/Welcome, Gina Google/)).toBeVisible();
  await gina.context().close();

  const mike = await fresh(browser);
  await mike.goto(at('/login'));
  await mike.getByRole('link', { name: 'Continue with Microsoft' }).click();
  await mike.waitForURL(at('/'));
  await expect(mike.getByText(/has not been added here/)).toBeVisible();
  await mike.context().close();

  // Gina is active now.
  await page.goto(at('/people?status=active'));
  await expect(page.getByRole('row', { name: /Gina Google/ })).toBeVisible();
});

test('High Command (students) runs the conference and posts announcements, but has no Owner area', async ({ page }) => {
  await signIn(page, 'hc@people.test');
  const menu = page.getByRole('navigation', { name: 'Main' });
  await expect(menu.getByRole('link', { name: 'Owner' })).toHaveCount(0);
  await menu.getByRole('link', { name: 'High Command' }).click();
  const tabs = page.getByRole('navigation', { name: 'Administration' });
  await expect(tabs.getByRole('link', { name: 'Website' })).toHaveCount(0);
  await expect(tabs.getByRole('link', { name: 'Audit log' })).toHaveCount(0);
  await tabs.getByRole('link', { name: 'Announcements' }).click();
  await page.getByLabel('Message, English').fill('Lunch is served in the gym.');
  await page.getByRole('button', { name: 'Post now' }).click();
  await expect(page.getByText('Posted. It shows now.')).toBeVisible();
  await page.goto(at('/'));
  await expect(page.getByText('Lunch is served in the gym.')).toBeVisible();
  for (const path of ['/owner', '/settings', '/settings/site', '/settings/access', '/people/audit']) {
    await page.goto(at(path));
    await expect(page.getByRole('heading', { level: 1 }), path).toHaveText('You do not have access to this page');
  }
});

test('the Owner area gathers every customisation, and says who can see it', async ({ page }) => {
  await signIn(page, 'owner@people.test');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Owner' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Owner');
  const cards = page.locator('main a.card');
  for (const name of ['Website', 'Branding', 'Conference details', 'Languages and words', 'Committee types', 'Rules of procedure', 'Grading and awards', 'People and sign-in', 'Access code', 'Roles and permissions', 'Audit log']) {
    await expect(cards.filter({ hasText: new RegExp(`^${name}`) })).toBeVisible();
  }
  // The cards are grouped under the same headings as the menu.
  for (const group of ['Your conference', 'Look and website', 'People and access', 'School and account']) await expect(page.getByRole('region', { name: group })).toBeVisible();
  await cards.filter({ hasText: /^Branding/ }).click();
  await expect(page.getByRole('navigation', { name: 'Owner menu' }).getByRole('link', { name: 'Design' })).toHaveAttribute('aria-current', 'page');
});
