import { expect, test, type Page } from '@playwright/test';
import { openSection, sectionOf } from './support/settings';

// These tests change one school's settings step by step, so they run in order.
test.describe.configure({ mode: 'serial' });

const PORT = 3100;
const HOST = 'epsilon';
const at = (path = '/') => `http://${HOST}.localhost:${PORT}${path}`;

async function signIn(page: Page, email: string, labels = { email: 'Email', password: 'Password', button: 'Sign in' }) {
  await page.goto(at('/login'));
  await page.getByLabel(labels.email).fill(email);
  await page.getByLabel(labels.password).fill('correct-password');
  await page.getByRole('button', { name: labels.button }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}
const ES = { email: 'Correo electrónico', password: 'Contraseña', button: 'Iniciar sesión' };

test('a chair sees no settings link and cannot open settings', async ({ page }) => {
  await signIn(page, 'chair@epsilon.test');
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0);
  await page.goto(at('/settings'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('You do not have access to this page');
});

test('settings open from the header, one section at a time, with a grouped menu', async ({ page }) => {
  await signIn(page, 'owner@epsilon.test');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings');
  const menu = page.getByRole('navigation', { name: 'Sections' });
  await expect(menu.getByRole('link')).toHaveText(['Identity', 'Design', 'Committee types', 'Rules of procedure', 'Grading and awards', 'Language', 'Words', 'Translations', 'People and sign-in']);
  await expect(menu.getByRole('link', { name: 'Identity' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('section#identity')).toBeVisible();
  await expect(page.locator('section#theme')).toHaveCount(0);

  await menu.getByRole('link', { name: 'People and sign-in' }).click();
  const people = sectionOf(page, 'people');
  await expect(people.getByLabel('Minimum password length')).toHaveValue('8');
  await expect(people.getByText('The fewest characters a password may have (8 to 128).')).toBeVisible();
  await expect(people.getByText('Using the default settings')).toBeVisible();
  await expect(page.getByText('You have unpublished changes')).toHaveCount(0);
  await expect(page.getByText('You have unsaved changes')).toHaveCount(0);

  const language = await openSection(page, HOST, 'locale');
  await expect(language.getByLabel('Show English first')).toBeChecked();
  const identity = await openSection(page, HOST, 'identity');
  await expect(identity.getByLabel('Time zone')).toHaveValue('UTC');
  // Time zones are grouped by region and show their offset.
  await expect(identity.getByLabel('Time zone').locator('optgroup[label="America"] option[value="America/Mexico_City"]')).toHaveText(/Mexico City \(GMT-\d+\)/);
});

test('unsaved changes are marked, and an invalid value saves nothing and stays to be fixed', async ({ page }) => {
  await signIn(page, 'owner@epsilon.test');
  const people = await openSection(page, HOST, 'people');
  const field = people.getByLabel('Minimum password length');

  await field.fill('12');
  await expect(people.getByRole('status')).toHaveText('You have unsaved changes');
  await field.fill('8');
  await expect(people.getByText('You have unsaved changes')).toHaveCount(0);

  // Force a value the browser would block, to prove the server refuses it.
  await field.evaluate((el: HTMLInputElement) => {
    el.removeAttribute('min');
    el.removeAttribute('max');
  });
  await field.fill('5');
  await people.getByRole('button', { name: 'Save draft' }).click();
  await expect(people.locator('p[role="alert"]').first()).toHaveText('Check this value.');
  await expect(people.getByText('Some values are not valid. Nothing was saved.')).toBeVisible();
  await expect(people.getByLabel('Minimum password length')).toHaveValue('5');

  await page.reload();
  await expect(sectionOf(page, 'people').getByLabel('Minimum password length')).toHaveValue('8');
  await expect(page.getByText('You have unpublished changes')).toHaveCount(0);
});

test('a saved draft is not live; preview shows it only to the editor; publishing makes it live', async ({ page, browser }) => {
  await signIn(page, 'owner@epsilon.test');
  let language = await openSection(page, HOST, 'locale');

  await language.getByLabel('Show Spanish (español) first').check();
  await language.getByRole('button', { name: 'Save draft' }).click();
  await page.waitForURL(/done=draft/);
  language = sectionOf(page, 'locale');
  await expect(language.getByRole('status')).toHaveText('Draft saved. It is not live until you publish it.');
  await expect(language.getByText(/^You have unpublished changes, saved /)).toBeVisible();
  // The menu marks the section with a draft.
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Language •' })).toBeVisible();
  await expect(language.getByLabel('Show Spanish (español) first')).toBeChecked();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings');

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(at('/login'));
  await expect(visitor.getByRole('heading', { level: 1 })).toHaveText('Sign in to Settings School');

  // Preview: the editor sees Spanish with a banner; the visitor does not.
  await language.getByRole('button', { name: 'Preview my drafts' }).click();
  await expect(page.getByText('Vista previa: estás viendo tus borradores sin publicar. Nadie más ve esto.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Configuración');
  await page.goto(at('/'));
  await expect(page.getByText('Tu rol: Propietario')).toBeVisible();
  await visitor.reload();
  await expect(visitor.getByRole('heading', { level: 1 })).toHaveText('Sign in to Settings School');

  // A preview cookie without the permission changes nothing.
  const chair = await (await browser.newContext()).newPage();
  await signIn(chair, 'chair@epsilon.test');
  await chair.context().addCookies([{ name: 's_preview', value: '1', url: at('/') }]);
  await chair.reload();
  await expect(chair.getByText('Your role: Chair')).toBeVisible();
  await expect(chair.getByText('Vista previa')).toHaveCount(0);
  await chair.context().close();

  // Leave preview, then publish with a note.
  await page.getByRole('button', { name: 'Salir de la vista previa' }).first().click();
  await expect(page.getByText('Your role: Owner')).toBeVisible();
  language = await openSection(page, HOST, 'locale');
  await language.getByLabel('What changed (optional)').fill('Spanish for everyone');
  await language.getByRole('button', { name: 'Publish now' }).click();
  await page.waitForURL(/done=published/);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Configuración');
  await expect(sectionOf(page, 'locale').getByRole('status')).toHaveText('Publicado. Ya está en vivo.');
  await expect(sectionOf(page, 'locale').getByText(/^En vivo: versión 1, publicada el .* por Erin Epsilon$/)).toBeVisible();
  await visitor.reload();
  await expect(visitor.getByRole('heading', { level: 1 })).toHaveText('Inicia sesión en Settings School');
  await visitor.context().close();
});

test('"Save and publish" makes a change live in one step; history lists versions and restores a copy', async ({ page, browser }) => {
  await signIn(page, 'owner@epsilon.test', ES);
  let idioma = await openSection(page, HOST, 'locale');
  await idioma.getByLabel('Mostrar inglés (English) primero').check();
  await idioma.getByRole('button', { name: 'Guardar y publicar' }).click();
  await page.waitForURL(/done=published/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings');

  const language = sectionOf(page, 'locale');
  await language.getByText('History and files').click();
  const items = language.getByRole('list', { name: 'History' }).getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Version 2');
  await expect(items.nth(0)).toContainText('live');
  await expect(items.nth(1)).toContainText('Version 1');
  await expect(items.nth(1)).toContainText('Spanish for everyone');
  await expect(items.nth(1)).toContainText('by Erin Epsilon');

  await items.nth(1).getByRole('button', { name: 'Restore this version' }).click();
  await page.waitForURL(/done=restored/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Configuración');
  idioma = sectionOf(page, 'locale');
  await expect(idioma.getByText(/^En vivo: versión 3/)).toBeVisible();
  await idioma.getByText('Historial y archivos').click();
  const historial = idioma.getByRole('list', { name: 'Historial' }).getByRole('listitem');
  await expect(historial).toHaveCount(3);
  await expect(historial.nth(0)).toContainText('copia de la versión 1');

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(at('/login'));
  await expect(visitor.getByRole('heading', { level: 1 })).toHaveText('Inicia sesión en Settings School');
  await visitor.context().close();
});

test('a draft can be discarded, and text in several languages is saved per language', async ({ page }) => {
  await signIn(page, 'owner@epsilon.test', ES);
  let identidad = await openSection(page, HOST, 'identity');
  await identidad.locator('#tagline\\.en').fill('Diplomacy first');
  await identidad.locator('#tagline\\.es').fill('La diplomacia primero');
  await identidad.getByLabel('Zona horaria').selectOption('America/Mexico_City');
  await identidad.getByRole('button', { name: 'Guardar borrador' }).click();
  await page.waitForURL(/done=draft/);
  identidad = sectionOf(page, 'identity');
  await expect(identidad.locator('#tagline\\.es')).toHaveValue('La diplomacia primero');
  await expect(identidad.getByLabel('Zona horaria')).toHaveValue('America/Mexico_City');

  await identidad.getByRole('button', { name: 'Descartar borrador' }).click();
  await page.waitForURL(/done=discarded/);
  identidad = sectionOf(page, 'identity');
  await expect(identidad.getByRole('status')).toHaveText('Borrador descartado.');
  await expect(identidad.locator('#tagline\\.es')).toHaveValue('');
  await expect(identidad.getByLabel('Zona horaria')).toHaveValue('UTC');
});
