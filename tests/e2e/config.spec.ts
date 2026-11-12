import { expect, test } from '@playwright/test';

const PORT = 3100;
const at = (host: string, path = '/') => `http://${host}:${PORT}${path}`;

test('a school with no saved settings uses the defaults', async ({ page }) => {
  await page.goto(at('alpha.localhost', '/login'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in to School Alpha');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test("a school's published language and tagline apply to visitors who are not signed in", async ({ page }) => {
  await page.goto(at('delta.localhost', '/login'));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Inicia sesión en Colegio Delta');
  await expect(page.getByText('La diplomacia primero')).toBeVisible();
  await expect(page.getByLabel('Correo electrónico')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible();
  await expect(page.getByText('Desarrollado con')).toBeVisible();
});

test("a school's password rule is shown and enforced by the server", async ({ page, browser }) => {
  await page.goto(at('delta.localhost', '/login'));
  await page.getByLabel('Correo electrónico').fill('owner@delta.test');
  await page.getByLabel('Contraseña').fill('correct-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByText('Tu rol: Propietario')).toBeVisible();

  await page.getByRole('link', { name: 'Personas e invitaciones' }).click();
  await page.getByLabel('Correo electrónico').fill(`nuevo-${Date.now().toString(36)}@delta.test`);
  await page.getByRole('button', { name: 'Crear invitación' }).click();
  const link = await page.getByLabel('Enlace de invitación').inputValue();

  const device = await browser.newContext();
  const guest = await device.newPage();
  await guest.goto(link);
  await guest.getByRole('button', { name: 'Continuar' }).click();
  await expect(guest.getByText('Al menos 12 caracteres.')).toBeVisible();

  // Ten characters passes the default rule (8) but not this school's (12). The browser's own
  // check is switched off to prove the server refuses it.
  const field = guest.getByLabel('Contraseña nueva');
  await field.evaluate((el: HTMLInputElement) => el.removeAttribute('minlength'));
  await field.fill('diez-chars');
  await guest.getByLabel('Repite la contraseña').fill('diez-chars');
  await guest.getByRole('button', { name: 'Guardar contraseña' }).click();
  await expect(guest.locator('p[role="alert"]')).toHaveText('Usa al menos 12 caracteres.');

  await field.fill('doce-caracteres-ok');
  await guest.getByLabel('Repite la contraseña').fill('doce-caracteres-ok');
  await guest.getByRole('button', { name: 'Guardar contraseña' }).click();
  // Invited with the preselected role, shown with the school's own Spanish name for it.
  await expect(guest.getByText('Tu rol: Mesa')).toBeVisible();
  await device.close();
});
