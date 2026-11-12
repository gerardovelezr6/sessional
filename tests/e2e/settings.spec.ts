import { expect, test, type Page } from '@playwright/test';

// These tests change one school's settings step by step, so they run in order.
test.describe.configure({ mode: 'serial' });

const PORT = 3100;
const HOST = 'epsilon.localhost';
const at = (path = '/') => `http://${HOST}:${PORT}${path}`;

async function signIn(page: Page, email: string, labels = { email: 'Email', password: 'Password', button: 'Sign in' }) {
  await page.goto(at('/login'));
  await page.getByLabel(labels.email).fill(email);
  await page.getByLabel(labels.password).fill('correct-password');
  await page.getByRole('button', { name: labels.button }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}
const ES = { email: 'Correo electrónico', password: 'Contraseña', button: 'Iniciar sesión' };
const section = (page: Page, name: string) => page.getByRole('region', { name });

test('a chair cannot open settings', async ({ page }) => {
  await signIn(page, 'chair@epsilon.test');
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  await page.goto(at('/settings'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('You do not have access to this page');
});

test('the form is generated from the registry, with defaults, help text and no draft yet', async ({ page }) => {
  await signIn(page, 'owner@epsilon.test');
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings');

  const people = section(page, 'People and sign-in');
  await expect(people.getByLabel('Minimum password length')).toHaveValue('8');
  await expect(people.getByText('The fewest characters a password may have (8 to 128).')).toBeVisible();
  await expect(people.getByText('Live: default values')).toBeVisible();
  await expect(section(page, 'Language').getByLabel('Default language')).toHaveValue('en');
  await expect(section(page, 'Identity').getByLabel('Time zone')).toHaveValue('UTC');
  await expect(page.getByText('Draft saved, not live yet')).toHaveCount(0);
  await expect(page.getByText('You have unsaved changes')).toHaveCount(0);
});

test('unsaved changes are marked, and an invalid value saves nothing', async ({ page }) => {
  await signIn(page, 'owner@epsilon.test');
  await page.goto(at('/settings'));
  const people = section(page, 'People and sign-in');
  const field = people.getByLabel('Minimum password length');

  await field.fill('12');
  await expect(people.getByRole('status')).toHaveText('You have unsaved changes');
  // Back to the original value: no longer marked.
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

  await page.reload();
  await expect(section(page, 'People and sign-in').getByLabel('Minimum password length')).toHaveValue('8');
  await expect(page.getByText('Draft saved, not live yet')).toHaveCount(0);
});

test('a saved draft is not live; preview shows it only to the editor; publishing makes it live', async ({ page, browser }) => {
  await signIn(page, 'owner@epsilon.test');
  await page.goto(at('/settings'));

  await section(page, 'Language').getByLabel('Default language').selectOption('es');
  await section(page, 'Language').getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved. It is not live until you publish it.' })).toBeVisible();
  await expect(section(page, 'Language').getByText('Draft saved, not live yet')).toBeVisible();
  // The form shows the draft, and the page itself is still in English.
  await expect(section(page, 'Language').getByLabel('Default language')).toHaveValue('es');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings');

  // A visitor still gets English.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(at('/login'));
  await expect(visitor.getByRole('heading', { level: 1 })).toHaveText('Sign in to Settings School');

  // Preview: the editor sees Spanish with a banner; the visitor still does not.
  await page.getByRole('button', { name: 'Preview my drafts' }).click();
  await expect(page.getByText('Vista previa: estás viendo tus borradores sin publicar. Nadie más ve esto.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Configuración');
  // The preview follows the editor to other pages.
  await page.goto(at('/'));
  await expect(page.getByText('Tu rol: Propietario')).toBeVisible();
  await expect(page.getByText('Vista previa: estás viendo')).toBeVisible();
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

  // Leave preview: back to English, then publish with a note.
  await page.getByRole('button', { name: 'Salir de la vista previa' }).click();
  await expect(page.getByText('Your role: Owner')).toBeVisible();
  await expect(page.getByText('Vista previa')).toHaveCount(0);
  await page.goto(at('/settings'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings');
  await section(page, 'Language').getByLabel('What changed (optional)').fill('Spanish for everyone');
  await section(page, 'Language').getByRole('button', { name: 'Publish' }).click();

  // Live now: the settings page itself is in Spanish, and so is the visitor's sign-in page.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Configuración');
  await expect(page.getByRole('status').filter({ hasText: 'Publicado. Ya está en vivo.' })).toBeVisible();
  await expect(section(page, 'Idioma').getByText('En vivo: versión 1')).toBeVisible();
  await expect(page.getByText('Borrador guardado, aún no está en vivo')).toHaveCount(0);
  await visitor.reload();
  await expect(visitor.getByRole('heading', { level: 1 })).toHaveText('Inicia sesión en Settings School');
  await visitor.context().close();
});

test('history lists every version, and restoring an old one publishes a copy of it', async ({ page, browser }) => {
  await signIn(page, 'owner@epsilon.test', ES);
  await page.goto(at('/settings'));

  // Version 2: back to English.
  await section(page, 'Idioma').getByLabel('Idioma predeterminado').selectOption('en');
  await section(page, 'Idioma').getByRole('button', { name: 'Guardar borrador' }).click();
  await section(page, 'Idioma').getByRole('button', { name: 'Publicar' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings');

  const language = section(page, 'Language');
  await language.getByText('History').click();
  const items = language.getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Version 2');
  await expect(items.nth(0)).toContainText('live');
  await expect(items.nth(1)).toContainText('Version 1');
  await expect(items.nth(1)).toContainText('Spanish for everyone');
  await expect(items.nth(1)).toContainText('by Erin Epsilon');

  // Restore version 1 (Spanish): it becomes version 3, a copy; nothing is rewritten.
  await items.nth(1).getByRole('button', { name: 'Restore this version' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Configuración');
  const idioma = section(page, 'Idioma');
  await expect(idioma.getByText('En vivo: versión 3')).toBeVisible();
  await idioma.getByText('Historial').click();
  await expect(idioma.getByRole('listitem')).toHaveCount(3);
  await expect(idioma.getByRole('listitem').nth(0)).toContainText('copia de la versión 1');

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(at('/login'));
  await expect(visitor.getByRole('heading', { level: 1 })).toHaveText('Inicia sesión en Settings School');
  await visitor.context().close();
});

test('a draft can be discarded, and text in several languages is saved per language', async ({ page }) => {
  await signIn(page, 'owner@epsilon.test', ES);
  await page.goto(at('/settings'));
  const identidad = section(page, 'Identidad');
  await identidad.getByLabel('Inglés').fill('Diplomacy first');
  await identidad.getByLabel('Español').fill('La diplomacia primero');
  await identidad.getByLabel('Zona horaria').selectOption('America/Mexico_City');
  await identidad.getByRole('button', { name: 'Guardar borrador' }).click();
  await expect(section(page, 'Identidad').getByLabel('Español')).toHaveValue('La diplomacia primero');
  await expect(section(page, 'Identidad').getByLabel('Zona horaria')).toHaveValue('America/Mexico_City');

  await section(page, 'Identidad').getByRole('button', { name: 'Descartar borrador' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Borrador descartado.' })).toBeVisible();
  await expect(section(page, 'Identidad').getByLabel('Español')).toHaveValue('');
  await expect(section(page, 'Identidad').getByLabel('Zona horaria')).toHaveValue('UTC');
});
