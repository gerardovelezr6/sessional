import type { Locator, Page } from '@playwright/test';

const PORT = 3100;

// Opens one settings section and returns it. Sections are found by their id, which does not change
// with the page's language.
export async function openSection(page: Page, host: string, section: string): Promise<Locator> {
  await page.goto(`http://${host}.localhost:${PORT}/settings?section=${section}`);
  return page.locator(`section#${section}`);
}

export const sectionOf = (page: Page, section: string) => page.locator(`section#${section}`);

// Picks an option in a row of buttons or cards (a group of radios named by the setting's title).
export async function choose(scope: Locator, setting: string, option: string): Promise<void> {
  await scope.getByRole('group', { name: setting, exact: true }).getByText(option, { exact: true }).click();
}

// Saves the open section, then waits for the page that confirms it.
export async function saveDraft(scope: Locator): Promise<void> {
  await scope.getByRole('button', { name: /^(Save draft|Guardar borrador)$/ }).click();
  await scope.page().waitForURL(/done=/);
}

export async function saveAndPublish(scope: Locator): Promise<void> {
  await scope.getByRole('button', { name: /^(Save and publish|Guardar y publicar)$/ }).click();
  await scope.page().waitForURL(/done=published/);
}
