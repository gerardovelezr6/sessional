import { expect, test, type Page } from '@playwright/test';

// One school builds its committees from nothing, step by step, so these run in order.
test.describe.configure({ mode: 'serial' });

const PORT = 3100;
const at = (path = '/') => `http://mumun.localhost:${PORT}${path}`;

async function signIn(page: Page, email: string) {
  await page.goto(at('/login'));
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}

async function openCommittee(page: Page, name: string) {
  await page.goto(at('/committees'));
  await page.getByRole('link', { name: new RegExp(`^${name}`) }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
}

test('the standard Model UN types are added from data and published', async ({ page }) => {
  await signIn(page, 'owner@mu.test');
  await page.goto(at('/settings?section=structure'));
  await expect(page.getByText('No categories · 1 type')).toBeVisible();
  await page.getByRole('link', { name: 'Edit committee types' }).click();

  await page.getByRole('button', { name: 'Add the standard Model UN types' }).click();
  await page.waitForURL(/done=draft/);
  const types = page.getByRole('list', { name: 'Committee types' });
  await expect(types.locator(':scope > li summary')).toHaveText([/^Standard/, /^Specialized/, /^US Senate/, /^Mexican Senate/, /^International Criminal Court/, /^Crisis committee/]);
  await expect(page.getByRole('list', { name: 'Categories' }).getByRole('listitem')).toHaveCount(4);

  // Each type keeps its own rules: the US Senate takes flags from states and has three parties.
  await types.locator('summary', { hasText: 'US Senate' }).click();
  const senate = types.locator(':scope > li').nth(2);
  await expect(senate.getByLabel('Flags')).toHaveValue('us_state');
  await expect(senate.getByRole('list', { name: /^Groups/ }).getByRole('listitem')).toHaveCount(3);
  await expect(senate.getByRole('list', { name: 'Column order when pasting' }).getByRole('listitem')).toHaveText([/Main column/, /Group/, /Student name/]);

  await page.getByRole('button', { name: 'Save and publish' }).click();
  await page.waitForURL(/done=published/);
  await expect(page.getByRole('status')).toHaveText('Published. It is live now.');
});

test('a conference is started and committees are added under their categories', async ({ page }) => {
  await signIn(page, 'owner@mu.test');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Committees' }).click();
  await expect(page.getByRole('heading', { name: 'Start your conference' })).toBeVisible();
  await page.getByLabel('Conference name').fill('Mu MUN 2027');
  await page.getByRole('button', { name: 'Start conference' }).click();
  await expect(page.getByText('Mu MUN 2027')).toBeVisible();
  await expect(page.getByText('No committees yet.')).toBeVisible();

  const add = async (name: string, type: string, category?: string) => {
    const form = page.locator('section', { has: page.getByRole('heading', { name: 'Add a committee' }) });
    await form.getByLabel('Name', { exact: true }).fill(name);
    await form.getByLabel('Type').selectOption({ label: type });
    if (category) await form.getByLabel('Category').selectOption({ label: category });
    await form.getByRole('button', { name: 'Add committee' }).click();
    await page.waitForURL(/done=added/);
    await expect(page.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();
  };
  await add('DISEC', 'Standard', 'General Assembly');
  await add('SOCHUM', 'Standard', 'General Assembly');
  await add('Senate', 'US Senate');
  await add('Cabinet', 'Crisis committee');

  // The type's usual category was used for the Senate and the Cabinet.
  await expect(page.getByRole('list', { name: 'General Assembly' }).getByRole('link')).toHaveText(['DISEC', 'SOCHUM']);
  await expect(page.getByRole('list', { name: 'Specialized Committees' }).getByRole('link')).toHaveText(['Senate', 'Cabinet']);
});

test('committees are reordered and the order is kept after a reload', async ({ page }) => {
  await signIn(page, 'owner@mu.test');
  await page.goto(at('/committees'));
  await page.getByRole('button', { name: 'Move SOCHUM up' }).click();
  await expect(page.getByText('New order saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('list', { name: 'General Assembly' }).getByRole('link')).toHaveText(['SOCHUM', 'DISEC']);

  // Dragging works too.
  const ga = page.getByRole('list', { name: 'General Assembly' });
  await ga.getByRole('listitem').nth(1).dragTo(ga.getByRole('listitem').nth(0));
  await expect(page.getByText('New order saved.')).toBeVisible();
  await page.reload();
  await expect(ga.getByRole('link')).toHaveText(['DISEC', 'SOCHUM']);
});

test('chairs are assigned and a confidential topic is kept from them until shown', async ({ page, browser }) => {
  await signIn(page, 'owner@mu.test');
  for (const name of ['Senate', 'Cabinet']) {
    await openCommittee(page, name);
    await page.getByLabel(/Chris Chair/).check();
    await page.getByRole('button', { name: 'Save', exact: true }).nth(1).click();
    await page.waitForURL(/done=chairs/);
    await expect(page.getByLabel(/Chris Chair/)).toBeChecked();
  }
  await page.getByRole('textbox', { name: 'Confidential topic' }).fill('The fleet has been seized.');
  await page.getByRole('button', { name: 'Save topic' }).click();
  await page.waitForURL(/done=secret/);
  await expect(page.getByRole('textbox', { name: 'Confidential topic' })).toHaveValue('The fleet has been seized.');

  const chair = await browser.newPage();
  await signIn(chair, 'chair@mu.test');
  await expect(chair.getByRole('heading', { name: 'Your committees' })).toBeVisible();
  await chair.getByRole('link', { name: 'Cabinet' }).click();
  await expect(chair.getByText('There is a confidential topic.')).toBeVisible();
  await expect(chair.getByText('The fleet has been seized.')).toHaveCount(0);
  // A chair cannot change the committee or delete it.
  await expect(chair.getByRole('button', { name: 'Delete…' })).toHaveCount(0);

  await page.goto(at('/committees'));
  await page.getByRole('button', { name: 'Show to Chairs now' }).click();
  await page.waitForURL(/done=secrets/);
  await expect(page.getByText(/Shown to Chairs since/)).toBeVisible();

  await chair.reload();
  await expect(chair.getByText('The fleet has been seized.')).toBeVisible();

  await page.getByRole('button', { name: 'Hide again' }).click();
  await expect(page.getByText('Hidden from Chairs. Only the organisers can read them.')).toBeVisible();
  await chair.reload();
  await expect(chair.getByText('The fleet has been seized.')).toHaveCount(0);
  await chair.close();
});

test('delegates are pasted in bulk with a preview, then edited and deleted', async ({ page }) => {
  await signIn(page, 'chair@mu.test');
  await openCommittee(page, 'Senate');
  await page.getByLabel('Rows to add').fill(['Ted Cruz (Texas)\tR\tAna López', 'Chuck Schumer (New York)\tDemocrat\tBen Ruiz', '\tR\tNobody', 'Bernie Sanders (Vermont)\tGreen\tCruz Díaz'].join('\n'));
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByText('2 rows ready 2 rows have problems and will be skipped.')).toBeVisible();
  const preview = page.getByRole('list', { name: 'Add many at once' });
  await expect(preview.getByRole('listitem').nth(2)).toContainText('the main column is empty');
  await expect(preview.getByRole('listitem').nth(3)).toContainText('unknown or missing group');

  await page.getByRole('button', { name: 'Add 2 rows' }).click();
  await page.waitForURL(/done=added/);
  await expect(page.getByRole('status')).toHaveText('2 added.');
  const rows = page.locator('#delegates tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Chuck Schumer (New York)');
  await expect(rows.nth(0)).toContainText('D');
  await expect(rows.nth(1).locator('img')).toHaveAttribute('src', '/flags/us/tx.svg');

  // The same name again is refused as a duplicate.
  await page.getByLabel('Rows to add').fill('ted cruz (texas)\tR\tX');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(preview).toContainText('already in the list');
  await expect(page.getByRole('button', { name: /^Add \d/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Edit Ted Cruz (Texas)' }).click();
  const edit = page.getByRole('form', { name: 'Edit Ted Cruz (Texas)' });
  await edit.getByLabel('Student').fill('Ana María López');
  await edit.getByRole('button', { name: 'Save' }).click();
  await page.waitForURL(/done=delegate/);
  await expect(rows.nth(1)).toContainText('Ana María López');

  await page.getByRole('button', { name: 'Delete Chuck Schumer (New York)' }).click();
  await page.getByRole('button', { name: 'Keep it' }).or(page.getByRole('button', { name: 'Cancel' })).first().click();
  await expect(rows).toHaveCount(2);
  await page.getByRole('button', { name: 'Delete Chuck Schumer (New York)' }).click();
  await page.getByRole('button', { name: 'Yes, delete' }).click();
  await page.waitForURL(/done=removed/);
  await expect(rows).toHaveCount(1);
});

test('one delegate is added with a country flag in a standard committee', async ({ page }) => {
  await signIn(page, 'owner@mu.test');
  await openCommittee(page, 'DISEC');
  const add = page.locator('section', { has: page.getByRole('heading', { name: 'Add one' }) });
  await add.getByLabel('Country').fill('Alemania');
  await add.getByLabel('Student').fill('Lia Ortiz');
  await add.getByRole('button', { name: 'Add', exact: true }).click();
  await page.waitForURL(/done=added/);
  await expect(page.locator('#delegates tbody tr .fi-de')).toHaveCount(1);
});

test('a member without committee rights sees committees but not who is in them', async ({ page }) => {
  await signIn(page, 'hc@mu.test');
  await openCommittee(page, 'DISEC');
  await expect(page.getByText("Only the organisers and this committee's Chairs see who is in it.")).toBeVisible();
  await expect(page.getByText('Lia Ortiz')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add committee' })).toHaveCount(0);
});

test('a type in use cannot be removed, and a committee is deleted after confirming', async ({ page }) => {
  await signIn(page, 'owner@mu.test');
  await page.goto(at('/settings/structure'));
  const types = page.getByRole('list', { name: 'Committee types' });
  await types.locator('summary', { hasText: 'Crisis committee' }).click();
  await types.locator(':scope > li').nth(5).getByRole('button', { name: 'Remove: Crisis committee' }).click();
  await page.getByRole('button', { name: 'Save and publish' }).click();
  await expect(page.locator('p[role=alert]')).toHaveText('Crisis committee is used by 1 committee. Move them to another type or category first.');

  await openCommittee(page, 'Cabinet');
  await page.getByRole('button', { name: 'Delete…' }).click();
  await page.getByRole('button', { name: 'Yes, delete Cabinet' }).click();
  await page.waitForURL(/done=deleted/);
  await expect(page.getByText('Committee deleted.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cabinet' })).toHaveCount(0);
});
