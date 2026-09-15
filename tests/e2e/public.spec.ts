import { test, expect } from '@playwright/test';
// Let streamed responses finish before closing a context or replacing its document.
test.afterEach(async ({ page }) => {
  await page.waitForLoadState('networkidle');
});
test('public routes, translations and theme persist without overflow', async ({
  page,
}, testInfo) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Qué bien tenerte por aquí.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuar con Google' })).toHaveCount(
    process.env.E2E_GOOGLE_ENABLED === 'true' ? 1 : 0,
  );
  await page.getByText('A tu manera', { exact: true }).click();
  await page.getByLabel('Idioma').selectOption('en');
  await page.getByLabel('Apariencia').selectOption('dark');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Good to have you here.' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: testInfo.outputPath('login-dark.png'),
    fullPage: true,
    caret: 'initial',
  });
  await page.getByRole('link', { name: 'Create account', exact: true }).click();
  await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await expect(page.getByRole('button', { name: 'Send link' })).toBeVisible();
  await page.getByText('Make it yours', { exact: true }).click();
  await page.getByLabel('Language').selectOption('es');
  await page.getByLabel('Appearance').selectOption('light');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await page.goto('/login');
  await page.screenshot({
    path: testInfo.outputPath('login-light.png'),
    fullPage: true,
    caret: 'initial',
  });
});
test('anonymous users cannot enter any protected workspace or account route', async ({ page }) => {
  for (const route of [
    '/homes',
    '/homes/new',
    '/homes/join',
    '/profile',
    '/homes/11111111-1111-4111-8111-111111111111',
    '/homes/11111111-1111-4111-8111-111111111111/settings',
    '/homes/11111111-1111-4111-8111-111111111111/chat',
    '/homes/11111111-1111-4111-8111-111111111111/organization',
    '/reset-password',
  ]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/login$/);
    await page.waitForLoadState('networkidle');
  }
});
test('invitation survives navigation to registration without joining automatically', async ({
  page,
}) => {
  const code = 'a'.repeat(32);
  await page.goto(`/invite/${code}`);
  await expect(page).toHaveURL(/\/login\?next=/);
  for (const input of await page.locator('input[name=next]').all())
    await expect(input).toHaveValue(`/homes/join?code=${code}`);
  if (process.env.E2E_GOOGLE_ENABLED === 'true')
    await expect(
      page
        .locator('form')
        .filter({ has: page.getByRole('button', { name: 'Continuar con Google' }) })
        .locator('input[name=next]'),
    ).toHaveValue(`/homes/join?code=${code}`);
  await page.getByRole('link', { name: 'Crear cuenta', exact: true }).click();
  for (const input of await page.locator('input[name=next]').all())
    await expect(input).toHaveValue(`/homes/join?code=${code}`);
});
test('unsafe next is sanitized in login and registration forms', async ({ page }) => {
  await page.goto('/login?next=' + encodeURIComponent('/%5cevil.test'));
  for (const input of await page.locator('input[name=next]').all())
    await expect(input).toHaveValue('/homes');
  await page.getByRole('link', { name: 'Crear cuenta', exact: true }).click();
  for (const input of await page.locator('input[name=next]').all())
    await expect(input).toHaveValue('/homes');
});
test('failed auth return keeps the invitation safely available for retry', async ({ page }) => {
  const next = '/homes/join?code=' + 'a'.repeat(32);
  for (const route of ['/auth/callback', '/auth/confirm']) {
    await page.goto(`${route}?next=${encodeURIComponent(next)}`);
    await expect(page).toHaveURL(/\/login\?error=link/);
    for (const input of await page.locator('input[name=next]').all())
      await expect(input).toHaveValue(next);
    await page.waitForLoadState('networkidle');
  }
  await page.goto('/auth/callback?next=' + encodeURIComponent('//evil.test'));
  await expect(page).toHaveURL(/127\.0\.0\.1:3100\/login/);
  for (const input of await page.locator('input[name=next]').all())
    await expect(input).toHaveValue('/homes');
});
