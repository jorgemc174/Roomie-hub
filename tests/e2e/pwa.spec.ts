import { test, expect } from '@playwright/test';
test('PWA public shell, real service worker, offline write guard and reconnect', async ({
  page,
  context,
  request,
}) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('/homes');
  expect(manifest.icons.map((x: { sizes: string }) => x.sizes)).toContain('192x192');
  expect(manifest.icons.some((x: { purpose: string }) => x.purpose === 'maskable')).toBe(true);
  await page.goto('/login');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await page.getByLabel('Correo electrónico', { exact: true }).fill('offline@example.test');
  await page.locator('[name=password]').fill('not-sent');
  let writes = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST') writes++;
  });
  await context.setOffline(true);
  await page
    .locator('form')
    .filter({ has: page.locator('[name=password]') })
    .locator('button[type=submit]')
    .click();
  await expect(page.getByRole('alert')).toContainText('No se han guardado');
  expect(writes).toBe(0);
  await page.goto('/homes');
  await expect(page.getByRole('heading', { name: 'Sin conexión', exact: true })).toBeVisible();
  await expect(
    page.getByText('No se ha enviado ninguna operación pendiente.', { exact: false }),
  ).toBeVisible();
  await context.setOffline(false);
  await page.getByRole('link', { name: 'Volver a intentar / Try again' }).click();
  await expect(page).toHaveURL(/login/);
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const key of await caches.keys())
      for (const r of await (await caches.open(key)).keys()) urls.push(new URL(r.url).pathname);
    return urls;
  });
  expect(cached.length).toBeGreaterThan(0);
  expect(cached.every((url) => url === '/offline.html' || url.startsWith('/icons/'))).toBe(true);
});
test('worker HTTP endpoint rejects missing or invalid credentials', async ({ request }) => {
  expect((await request.post('/api/jobs/notifications')).status()).toBe(401);
  expect(
    (
      await request.post('/api/jobs/notifications', {
        headers: { Authorization: 'Bearer invalid' },
      })
    ).status(),
  ).toBe(401);
});
