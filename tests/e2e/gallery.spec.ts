import { expect, test, type Page } from '@playwright/test';
import { choose, openSection, saveAndPublish, sectionOf } from './support/settings';

// Phase 16: the community gallery. Sharing School shares its design; Sessional reviews it (a
// rejection says why); Taking School installs it as a draft, publishes it, and rolls it back.
test.describe.configure({ mode: 'serial' });

const PORT = 3100;
const share = (path = '/') => `http://share.localhost:${PORT}${path}`;
const take = (path = '/') => `http://take.localhost:${PORT}${path}`;
const admin = (path = '/') => `http://admin.localhost:${PORT}${path}`;

async function signIn(page: Page, url: string, email: string) {
  await page.goto(url);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login'));
}
const corners = (page: Page) => sectionOf(page, 'theme').getByRole('group', { name: 'Corners', exact: true }).getByRole('radio', { name: 'Square' });

async function review(page: Page, approve: boolean, reason = '') {
  await page.goto(admin('/gallery'));
  const item = page.getByRole('article').filter({ hasText: 'Square corners' });
  if (approve) await item.getByRole('button', { name: 'Approve', exact: true }).click();
  else {
    await item.getByLabel('Why (the school sees this)').fill(reason);
    await item.getByRole('button', { name: 'Don’t approve' }).click();
  }
  await expect(page.getByRole('status')).toContainText(approve ? 'Approved.' : 'Not approved.');
}

test('a school shares a published section; defaults alone can’t be shared; only managers see the gallery', async ({ page, browser }) => {
  await signIn(page, share('/login'), 'owner@share.test');
  const design = await openSection(page, 'share', 'theme');
  await choose(design, 'Corners', 'Square');
  await saveAndPublish(design);
  await sectionOf(page, 'theme').getByText('History and files').click();
  await sectionOf(page, 'theme').getByRole('link', { name: 'Share this in the gallery' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Share in the gallery');
  await expect(page.getByLabel('What to share')).toHaveValue('theme');

  // A section the school never changed has nothing to share.
  await page.getByLabel('What to share').selectOption('grading');
  await page.getByLabel('Name in English').fill('Plain grading');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.getByText('This section still has Sessional’s defaults.')).toBeVisible();

  await page.getByLabel('What to share').selectOption('theme');
  await page.getByLabel('Name in English').fill('Square corners');
  await page.getByLabel('Name in Spanish').fill('Esquinas rectas');
  await page.getByLabel('Description in English').fill('A sober look with square corners.');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.getByRole('status')).toHaveText('Sent for review. It appears in the gallery once Sessional approves it.');
  const mine = page.getByRole('region', { name: 'What your school shared' });
  await expect(mine).toContainText('Square corners');
  await expect(mine).toContainText('Version 1');
  await expect(mine).toContainText('Waiting for review');

  // Not in the gallery before review.
  const other = await (await browser.newContext()).newPage();
  await signIn(other, take('/login'), 'owner@take.test');
  await other.goto(take('/owner/gallery'));
  await expect(other.getByText('Nothing has been shared yet.')).toBeVisible();
  await other.context().close();

  // A chair (a student) can't share or browse.
  const chair = await (await browser.newContext()).newPage();
  await signIn(chair, share('/login'), 'chair@share.test');
  await chair.goto(share('/owner/gallery/share'));
  await expect(chair.getByRole('heading', { level: 1 })).not.toHaveText('Share in the gallery');
  await chair.context().close();
});

test('a review that doesn’t approve says why; the next version is reviewed against the last', async ({ page, browser }) => {
  // The reviewer sees what it changes before approving.
  await signIn(page, admin('/login'), 'root@platform.test');
  await page.getByRole('navigation', { name: 'Admin console' }).getByRole('link', { name: 'Gallery' }).click();
  const item = page.getByRole('article').filter({ hasText: 'Square corners' });
  await expect(item).toContainText('Sharing School (share)');
  await expect(item.getByRole('listitem').filter({ hasText: 'Corners' })).toBeVisible();
  await expect(item).toContainText('Nothing was approved before this version.');
  await item.getByRole('button', { name: 'Don’t approve' }).click();
  await expect(item.getByText('Say why, so the school can fix it.')).toBeVisible();
  await review(page, false, 'Please add a Spanish description.');

  const school = await (await browser.newContext()).newPage();
  await signIn(school, share('/login'), 'owner@share.test');
  await school.goto(share('/owner/gallery/share'));
  const mine = school.getByRole('region', { name: 'What your school shared' });
  await expect(mine).toContainText('Not approved');
  await expect(mine).toContainText('Why: Please add a Spanish description.');
  await school.getByRole('combobox', { name: /^As/ }).selectOption({ label: 'Next version of “Square corners” (Design)' });
  await school.getByLabel('Description in Spanish').fill('Un estilo sobrio con esquinas rectas.');
  await school.getByLabel('What’s new in this version, in English').fill('Spanish description.');
  await school.getByRole('checkbox').check();
  await school.getByRole('button', { name: 'Send for review' }).click();
  await expect(school.getByRole('status')).toContainText('Sent for review.');
  await expect(mine).toContainText('Version 2');
  await school.context().close();

  await page.goto(admin('/gallery'));
  const second = page.getByRole('article').filter({ hasText: 'Square corners, version 2' });
  await expect(second).toContainText('Nothing was approved before this version.');
  // A description added in one language keeps the other.
  await expect(second).toContainText('A sober look with square corners.');
  await review(page, true);
});

test('another school installs it as a draft, publishes it, and rolls it back', async ({ page }) => {
  await signIn(page, take('/login'), 'owner@take.test');
  // The school has its own design first, so there is something to roll back to.
  const design = await openSection(page, 'take', 'theme');
  await choose(design, 'Corners', 'Very rounded');
  await saveAndPublish(design);

  await page.goto(take('/owner'));
  await page.getByRole('link', { name: 'Community gallery', exact: true }).click();
  await page.getByRole('navigation', { name: 'Kind' }).getByRole('link', { name: 'Design' }).click();
  const card = page.getByRole('listitem').filter({ hasText: 'Square corners' });
  await expect(card).toContainText('Design · Shared by Sharing School · Version 2 · not installed yet');
  await card.getByRole('link', { name: 'Square corners' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Corners' })).toBeVisible();
  await expect(page.getByText('Your logo, icon and the names on your certificates stay as they are.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Install version 1 as a draft' })).toHaveCount(0); // not approved
  await page.getByRole('button', { name: 'Install version 2 as a draft' }).click();

  // A draft: nothing is live until it is published.
  await expect(page.getByRole('status')).toContainText('Installed from the gallery as a draft.');
  await expect(corners(page)).toBeChecked();
  await expect(page.getByText('You have unpublished changes')).toBeVisible();
  await saveAndPublish(sectionOf(page, 'theme'));
  await expect(corners(page)).toBeChecked();

  // Rolled back to the school's own design.
  const theme = sectionOf(page, 'theme');
  await theme.getByText('History and files').click();
  const items = theme.getByRole('list', { name: 'History' }).getByRole('listitem');
  await expect(items).toHaveCount(2);
  await items.nth(1).getByRole('button', { name: 'Restore this version' }).click();
  await page.waitForURL(/done=restored/);
  await expect(sectionOf(page, 'theme').getByRole('group', { name: 'Corners', exact: true }).getByRole('radio', { name: 'Very rounded' })).toBeChecked();

  // The gallery remembers what the school installed, and counts it once.
  await page.goto(take('/owner/gallery'));
  const after = page.getByRole('listitem').filter({ hasText: 'Square corners' });
  await expect(after).toContainText('installed by 1 school');
  await expect(after).toContainText('You installed version 2.');
});

test('the main website lists it; the sharing school can take it out', async ({ page, browser }) => {
  await page.goto(`http://localhost:${PORT}/gallery`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Community gallery');
  await expect(page.getByRole('region', { name: 'Design' })).toContainText('Square corners');
  await expect(page.getByRole('region', { name: 'Design' })).toContainText('Shared by Sharing School · Version 2 · installed by 1 school');
  await page.goto(`http://localhost:${PORT}/gallery?lang=es`);
  await expect(page.getByRole('heading', { name: 'Esquinas rectas' })).toBeVisible();

  const school = await (await browser.newContext()).newPage();
  await signIn(school, share('/login'), 'owner@share.test');
  await school.goto(share('/owner/gallery/share'));
  await school.getByRole('button', { name: 'Take it out of the gallery' }).click();
  await expect(school.getByRole('status')).toContainText('Taken out of the gallery.');
  await school.context().close();

  await page.goto(`http://localhost:${PORT}/gallery`);
  await expect(page.getByText('Nothing has been shared yet.')).toBeVisible();
});
