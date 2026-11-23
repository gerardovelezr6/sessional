import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// Phase 11: importing delegations from a spreadsheet, with a preview, an error report and undo.
test.describe.configure({ mode: 'serial' });

const PORT = 3100;
const at = (path = '/') => `http://pub.localhost:${PORT}${path}`;

async function signIn(page: Page, email: string) {
  await page.goto(at('/login'));
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}

// 500 rows: 30 of them bad whatever the options (unknown committee, no country, already in the committee); 230 more name GA1, which does not exist.
function sheet(): string {
  const lines = ['Comité;País;Nombre'];
  for (let i = 0; i < 500; i++) {
    if (i % 50 === 0) lines.push(`Nowhere;Country ${i};`);
    else if (i % 50 === 1) lines.push(`SC;;No country`);
    else if (i % 50 === 2) lines.push(`SC;Brazil;`);
    else lines.push(`${i % 2 ? 'SC' : 'GA1'};Country ${i};Student ${i}`);
  }
  return lines.join('\n');
}

test('a 500-row sheet with errors imports the good rows, reports the rest, and undoes cleanly', async ({ page }) => {
  await signIn(page, 'owner@pub.test');
  await page.goto(at('/admin'));
  await page.getByRole('navigation', { name: 'Administration' }).getByRole('link', { name: 'Import' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Import delegations');

  await page.getByLabel('CSV or Excel file').setInputFiles({ name: 'delegations.csv', mimeType: 'text/csv', buffer: Buffer.from(sheet()) });
  await page.getByLabel('Create committees the sheet names').check();
  await page.getByRole('button', { name: 'Check the sheet' }).click();
  // GA1 and Nowhere are created as new committees; only the empty and duplicate rows are bad.
  await expect(page.getByRole('status')).toHaveText('480 rows can be imported. 20 cannot.');
  await expect(page.getByText('New committees: Nowhere, GA1')).toBeVisible();

  // Without creating committees, the unknown ones are reported too.
  await page.getByLabel('CSV or Excel file').setInputFiles({ name: 'delegations.csv', mimeType: 'text/csv', buffer: Buffer.from(sheet()) });
  await page.getByLabel('Create committees the sheet names').uncheck();
  await page.getByRole('button', { name: 'Check the sheet' }).click();
  await expect(page.getByRole('status')).toHaveText('240 rows can be imported. 260 cannot.');
  const bad = page.getByRole('table', { name: 'Rows that cannot be imported' });
  await expect(bad.getByRole('row', { name: /^2 / })).toContainText('Committee not found in this conference');
  await expect(bad.getByRole('row', { name: /^3 / })).toContainText('No country or role');
  await expect(bad.getByRole('row', { name: /^4 / })).toContainText('Already in this committee');
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: /Download the rows that cannot be imported/ }).click();
  const report = readFileSync(await (await download).path(), 'utf8');
  expect(report.split('\r\n').filter(Boolean)).toHaveLength(261);
  expect(report).toContain('Committee not found in this conference');

  await page.getByRole('button', { name: 'Import 240 rows' }).click();
  await expect(page.getByText('240 delegations imported. You can undo it below.')).toBeVisible();
  await page.goto(at('/committees/00000000-0000-4000-9600-000000000001'));
  await expect(page.getByRole('link', { name: 'Delegates (242)' })).toBeVisible();

  await page.goto(at('/import'));
  const history = page.getByRole('region', { name: 'Earlier imports' });
  await expect(history).toContainText('240 of 500 rows');
  await history.getByRole('button', { name: 'Undo the import delegations.csv' }).click();
  await history.getByRole('button', { name: 'Remove 240 delegations' }).click();
  await expect(page.getByText('Import undone: 240 delegations removed.')).toBeVisible();
  await expect(history).toContainText(/Undone/);
  await page.goto(at('/committees/00000000-0000-4000-9600-000000000001'));
  await expect(page.getByRole('link', { name: 'Delegates (2)' })).toBeVisible();
});

test('the column mapping can be changed before importing', async ({ page }) => {
  await signIn(page, 'owner@pub.test');
  await page.goto(at('/import'));
  await page.getByLabel('CSV or Excel file').setInputFiles({ name: 'plain.csv', mimeType: 'text/csv', buffer: Buffer.from('Peru,Lima Student\nChile,Santiago Student\n') });
  await page.getByLabel('Committee for rows that do not name one').selectOption({ label: 'SC · Security Council' });
  await page.getByRole('button', { name: 'Check the sheet' }).click();
  // Without headings the first column is taken as the committee: nothing fits.
  await expect(page.getByRole('status')).toHaveText('0 rows can be imported. 2 cannot.');
  const columns = page.getByRole('form', { name: 'Which column holds what' });
  await columns.getByLabel('Committee').selectOption({ label: 'Not in the sheet' });
  await columns.getByLabel('Country or role').selectOption({ label: 'Column 1' });
  await columns.getByLabel("Student's name").selectOption({ label: 'Column 2' });
  await columns.getByRole('button', { name: 'Check again' }).click();
  await expect(page.getByRole('status')).toHaveText('2 rows can be imported. 0 cannot.');
  await page.getByRole('button', { name: 'Import 2 rows' }).click();
  await expect(page.getByText('2 delegations imported.', { exact: false })).toBeVisible();
});

test('a chair cannot import', async ({ page }) => {
  await signIn(page, 'chair@pub.test');
  await page.goto(at('/import'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('You do not have access to this page');
});
