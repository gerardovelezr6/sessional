import { expect, test, type Page } from '@playwright/test';

// Motions, points, votes, vetoes, documents, discipline and lost connections, in one committee.
test.describe.configure({ mode: 'serial' });

const PORT = 3100;
const MOCK = 'http://localhost:3199';
const COMMITTEE = '00000000-0000-4000-9000-000000000003';
const at = (path = '/') => `http://rules.localhost:${PORT}${path}`;
const CONSOLE = `/committees/${COMMITTEE}/console`;

async function signIn(page: Page, email: string, path = CONSOLE) {
  await page.goto(at('/login'));
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
  await page.goto(at(path));
}

const saved = (page: Page, timeout = 5000) => expect(page.getByText('All changes saved.')).toBeVisible({ timeout });
const section = (page: Page, id: string) => page.locator('section', { has: page.locator(`#${id}`) });
const ballot = (page: Page, delegate: string, choice: string) =>
  section(page, 'vote-title').getByRole('group', { name: delegate, exact: true }).getByRole('button', { name: choice, exact: true });

test('motions are voted in order of precedence and the one that passes takes effect', async ({ page }) => {
  await signIn(page, 'chair@rules.test');
  await page.getByRole('button', { name: 'Open session 1' }).click();
  await page.getByRole('button', { name: /Mark everyone not answered as Absent/ }).waitFor();
  for (const d of ['Brazil', 'China', 'France', 'Kenya', 'Mexico']) await page.getByRole('group', { name: d, exact: true }).getByRole('button', { name: 'Present', exact: true }).click();
  await saved(page);

  const motions = section(page, 'motions-title');
  await motions.getByText('Add a motion').click();
  await motions.getByRole('button', { name: 'Moderated caucus', exact: true }).click();
  await motions.getByLabel('Moved by').selectOption({ label: 'Kenya' });
  await motions.getByLabel('Minutes (up to 20)').fill('5');
  await motions.getByLabel('Speaking time, in seconds').fill('45');
  await motions.getByLabel('Topic').fill('Water');
  await motions.getByRole('button', { name: 'Add motion' }).click();
  await saved(page);
  await motions.getByRole('button', { name: 'Unmoderated caucus', exact: true }).click();
  await motions.getByLabel('Minutes (up to 20)').fill('3');
  await motions.getByRole('button', { name: 'Add motion' }).click();
  await saved(page);

  const floor = motions.getByRole('list', { name: 'Motions on the floor' });
  await expect(floor.getByRole('listitem')).toHaveText([/^1\. Unmoderated caucus/, /^2\. Moderated caucus.*moved by Kenya/]);
  // Only the first can be voted on, once seconded.
  await expect(motions.getByRole('button', { name: 'Put to a vote' })).toHaveCount(0);
  await floor.getByRole('listitem').first().getByRole('button', { name: 'Second it' }).click();
  await motions.getByRole('button', { name: 'Put to a vote' }).click();
  await saved(page);

  const vote = section(page, 'vote-title');
  await expect(page.locator('#vote-title')).toHaveText('Voting: Unmoderated caucus');
  await vote.getByLabel('Yes').fill('2');
  await vote.getByLabel('No').fill('3');
  await vote.getByRole('button', { name: 'Save the count' }).click();
  await saved(page);
  await vote.getByRole('button', { name: 'Close the vote and announce the result' }).click();
  await saved(page);
  await expect(vote.getByRole('status')).toHaveText(/^Failed: Unmoderated caucus\. Yes 2, no 3/);
  await expect(floor.getByRole('listitem')).toHaveText([/^1\. Moderated caucus/]);

  await floor.getByRole('button', { name: 'Second it' }).click();
  await motions.getByRole('button', { name: 'Put to a vote' }).click();
  await vote.getByLabel('Yes').fill('5');
  await vote.getByRole('button', { name: 'Save the count' }).click();
  await vote.getByRole('button', { name: 'Close the vote and announce the result' }).click();
  await saved(page);
  await expect(page.locator('#floor-title')).toHaveText('Moderated caucus: Water');
  await expect(floor.getByRole('listitem')).toHaveCount(0);
  await page.locator('#floor-title').locator('..').getByRole('button', { name: 'End caucus' }).click();
  await page.getByRole('button', { name: 'Yes, end the caucus' }).click();
  await saved(page);
});

test('points that interrupt come first', async ({ page }) => {
  await signIn(page, 'chair@rules.test');
  const points = section(page, 'points-title');
  await page.getByRole('combobox', { name: 'Point', exact: true }).selectOption({ label: 'Point of parliamentary inquiry' });
  await points.getByRole('button', { name: 'Raise point' }).click();
  await page.getByRole('combobox', { name: 'Point', exact: true }).selectOption({ label: 'Point of order' });
  await page.getByRole('combobox', { name: 'Raised by' }).selectOption({ label: 'Mexico' });
  await points.getByRole('button', { name: 'Raise point' }).click();
  await saved(page);
  await expect(points.getByRole('list', { name: 'Points' }).getByRole('listitem')).toHaveText([/^Point of order · Mexico/, /^Point of parliamentary inquiry/]);
  await points.getByRole('button', { name: 'Dealt with' }).first().click();
  await saved(page);
  await expect(points.getByRole('list', { name: 'Points' }).getByRole('listitem')).toHaveCount(1);
});

test('a draft resolution goes through the workflow, with the rules checked', async ({ page }) => {
  await signIn(page, 'chair@rules.test', `/committees/${COMMITTEE}/documents`);
  const create = async (title: string, sponsors: string[], signatories: string[]) => {
    const form = section(page, 'new-doc');
    await form.getByLabel('Kind').selectOption({ label: 'Draft resolution' });
    await form.getByLabel('Title').fill(title);
    for (const s of sponsors) await form.getByRole('group', { name: 'Sponsors' }).getByLabel(s).check();
    for (const s of signatories) await form.getByRole('group', { name: 'Signatories' }).getByLabel(s).check();
    await form.getByRole('button', { name: 'Create' }).click();
    await page.waitForURL(/done=saved/);
  };
  await create('Too few', ['China'], []);
  const tooFew = page.getByRole('listitem').filter({ hasText: 'Too few' });
  await tooFew.getByRole('button', { name: 'Submit' }).click();
  await expect(tooFew.getByText('Submitted', { exact: true })).toBeVisible();
  await tooFew.getByRole('button', { name: 'Approve' }).click();
  await expect(tooFew.getByRole('alert')).toHaveText('It needs at least 2 sponsors.');

  await create('Clean water', ['China', 'France'], ['Kenya', 'Mexico', 'Brazil']);
  const doc = page.getByRole('listitem').filter({ hasText: 'Clean water' });
  for (const step of ['Submit', 'Approve', 'Introduce on the floor']) {
    await doc.getByRole('button', { name: step }).click();
    await page.waitForURL(/done=status/);
  }
  await expect(doc.getByText('On the floor', { exact: true })).toBeVisible();
});

test('one veto defeats a resolution in a roll call', async ({ page }) => {
  await signIn(page, 'chair@rules.test');
  const vote = section(page, 'vote-title');
  await vote.getByLabel('Vote on').selectOption({ label: 'Clean water' });
  await vote.getByRole('button', { name: 'Roll call' }).click();
  await vote.getByRole('button', { name: 'Open the vote' }).click();
  await saved(page);
  await expect(page.locator('#vote-title')).toHaveText('Voting: Clean water');
  await expect(vote.getByText('holds a veto')).toHaveCount(2);
  for (const d of ['Brazil', 'France', 'Kenya', 'Mexico']) await ballot(page, d, 'Yes').click();
  await ballot(page, 'China', 'No').click();
  await saved(page);
  await expect(vote.getByText('Vetoed', { exact: true })).toBeVisible();
  await vote.getByRole('button', { name: 'Close the vote and announce the result' }).click();
  await saved(page);
  await expect(vote.getByRole('status')).toHaveText(/^Vetoed: Clean water\. Yes 4, no 1/);

  await page.goto(at(`/committees/${COMMITTEE}/documents`));
  await expect(page.getByRole('listitem').filter({ hasText: 'Clean water' }).getByText('Failed', { exact: true })).toBeVisible();
});

test('pulling the network mid-vote loses nothing', async ({ page, context }) => {
  await signIn(page, 'chair@rules.test');
  const vote = section(page, 'vote-title');
  await vote.getByLabel('Vote on').selectOption({ label: 'Something else…' });
  await vote.getByLabel('What is being voted on').fill('Emergency measure');
  await vote.getByRole('button', { name: 'Roll call' }).click();
  await vote.getByRole('button', { name: 'Open the vote' }).click();
  await saved(page);

  await context.setOffline(true);
  for (const d of ['Brazil', 'China', 'France']) await ballot(page, d, 'Yes').click();
  await ballot(page, 'Kenya', 'Abstain').click();
  await ballot(page, 'Mexico', 'No').click();
  // Shown at once as waiting, never as saved.
  await expect(page.getByText(/No connection\. \d changes? (is|are) waiting/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('All changes saved.')).toHaveCount(0);
  await expect(ballot(page, 'Mexico', 'No')).toHaveAttribute('aria-pressed', 'true');

  await context.setOffline(false);
  await saved(page, 30_000);
  await page.reload();
  for (const d of ['Brazil', 'China', 'France']) await expect(ballot(page, d, 'Yes')).toHaveAttribute('aria-pressed', 'true');
  await expect(ballot(page, 'Kenya', 'Abstain')).toHaveAttribute('aria-pressed', 'true');
  await expect(ballot(page, 'Mexico', 'No')).toHaveAttribute('aria-pressed', 'true');
  await vote.getByRole('button', { name: 'Close the vote and announce the result' }).click();
  await saved(page);
  await expect(vote.getByRole('status')).toHaveText(/^Passed: Emergency measure\. Yes 3, no 1, abstain 1/);
});

test('a change still unsent when the page reloads is sent afterwards, once', async ({ page, request }) => {
  await signIn(page, 'chair@rules.test');
  await request.post(`${MOCK}/__test/drop-commits`, { data: { count: 1 } });
  const chips = page.locator('#floor-title').locator('..').getByRole('group', { name: 'Add to the list' });
  await chips.getByRole('button', { name: '+ Brazil' }).click();
  await expect(page.getByText(/Saving 1 change/)).toBeVisible();
  await page.reload();
  await saved(page, 30_000);
  const list = page.locator('#floor-title').locator('..').getByRole('list', { name: 'General speakers list' });
  await expect(list.getByRole('listitem')).toHaveText([/Brazil/]);
});

test('warnings add up to losing the vote, and can be cleared', async ({ page }) => {
  await signIn(page, 'chair@rules.test');
  const discipline = section(page, 'discipline-title');
  await discipline.getByLabel('Who').selectOption({ label: 'Kenya' });
  await discipline.getByLabel('Level').selectOption({ label: 'Formal warning' });
  await discipline.getByLabel('Reason (short)').fill('Phones');
  await discipline.getByRole('button', { name: 'Give warning' }).click();
  await saved(page);
  await discipline.getByLabel('Level').selectOption({ label: 'Warning' });
  await discipline.getByRole('button', { name: 'Give warning' }).click();
  await saved(page);
  await expect(discipline.getByRole('list', { name: 'Discipline' })).toContainText('Kenya: 3 points · cannot vote');

  const vote = section(page, 'vote-title');
  await vote.getByLabel('Vote on').selectOption({ label: 'Something else…' });
  await vote.getByLabel('What is being voted on').fill('Test');
  await vote.getByRole('button', { name: 'Open the vote' }).click();
  await saved(page);
  await expect(vote.getByText(/4 may vote/)).toBeVisible();
  await vote.getByRole('button', { name: 'Cancel the vote' }).click();
  await vote.getByRole('button', { name: 'Yes, cancel it' }).click();
  await discipline.getByRole('button', { name: 'Clear warnings' }).click();
  await saved(page);
  await expect(discipline.getByText('No warnings.')).toBeVisible();
});

test('keyboard shortcuts run the floor', async ({ page }) => {
  await signIn(page, 'chair@rules.test');
  await page.keyboard.press('n');
  await saved(page);
  await expect(page.locator('#floor-title').locator('..').getByText('Brazil', { exact: true })).toBeVisible();
  await page.keyboard.press('s');
  await saved(page);
  await expect(page.locator('#floor-title').locator('..').getByText('Running')).toBeVisible();
  await page.keyboard.press('e');
  await saved(page);
  await expect(page.locator('#floor-title').locator('..').getByText('Nobody yet. Call the next speaker.')).toBeVisible();
});

test('the school edits its own rules, and topics can show by themselves', async ({ page }) => {
  await signIn(page, 'owner@rules.test', '/settings?section=protocol');
  await expect(page.getByText('You use the starting point as it is.')).toBeVisible();
  await page.getByRole('link', { name: 'Edit the rules of procedure' }).click();
  await page.getByText('Speaking and sessions').click();
  await page.getByLabel('Usual speaking time (seconds)').fill('75');
  await page.getByText(/^Motions \(/).click();
  await expect(page.getByRole('list', { name: 'Motions' }).getByRole('listitem')).toHaveCount(7);
  await page.getByRole('button', { name: 'Remove: Suspend the meeting' }).click();
  await page.getByRole('button', { name: 'Save and publish' }).click();
  await page.waitForURL(/done=published/);
  await page.getByText(/^Motions \(/).click();
  await expect(page.getByRole('list', { name: 'Motions' }).getByRole('listitem')).toHaveCount(6);
  await page.goto(at('/settings?section=protocol'));
  await expect(page.getByText('You use your own version of these rules.')).toBeVisible();

  await page.goto(at('/committees'));
  await page.getByLabel('When at least half of the committees have a session open').check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL(/done=secrets/);
  await expect(page.getByLabel('When at least half of the committees have a session open')).toBeChecked();
});

test('on a phone, the floor bar stays at hand', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await signIn(page, 'chair@rules.test');
  const bar = page.getByRole('region', { name: 'Floor', exact: true });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Next speaker' })).toBeVisible();
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(bar).toBeHidden();
});
