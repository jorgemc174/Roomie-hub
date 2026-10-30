// Browser integration tests for touch gestures, calendar state and existing inline forms, without remote accounts.
import { createRequire } from 'node:module';
// Reuse the bundler already supplied by the locked tsx development dependency.
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('tsx'))('esbuild');
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, readdir, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const root = process.cwd(),
  temp = await mkdtemp(path.join(tmpdir(), 'roomie-navigation-'));
const outfile = path.join(temp, 'fixture.js');
await build({
  entryPoints: ['tests/fixtures/navigation/app.tsx'],
  outfile,
  bundle: true,
  platform: 'browser',
  alias: { 'next/navigation': path.join(root, 'tests/fixtures/navigation/router.tsx') },
  define: { 'process.env.NODE_ENV': '"production"' },
});
const js = await readFile(outfile);
const chunks = await readdir('.next/static/chunks').catch(() => {
  throw new Error('Run pnpm build before the component browser tests.');
});
const css = (
  await Promise.all(
    chunks
      .filter((x) => x.endsWith('.css'))
      .map((x) => readFile(`.next/static/chunks/${x}`, 'utf8')),
  )
).join('\n');
const server = createServer((req, res) => {
  if (req.url === '/fixture.js') {
    res.setHeader('Content-Type', 'application/javascript');
    return res.end(js);
  }
  if (req.url === '/fixture.css') {
    res.setHeader('Content-Type', 'text/css');
    return res.end(css);
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script>globalThis.process={env:{NODE_ENV:"production"}};</script><script src="/fixture.js"></script></body></html>',
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium',
});
let scenarios = 0;
const screenshotDirectory = process.env.NAVIGATION_SCREENSHOTS_DIR;
if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true });
try {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 667, height: 375 },
  ]) {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const origin = `http://127.0.0.1:${address.port}`;
    await page.goto(origin);
    await page.locator('[data-testid=swipe-area]').waitFor();
    const cdp = await context.newCDPSession(page);
    async function swipe(element, dx, dy = 0) {
      await element.scrollIntoViewIfNeeded();
      const rect = await element.boundingBox();
      const x = Math.min(viewport.width - 60, rect.x + rect.width * 0.72),
        y = rect.y + Math.min(rect.height / 2, 50);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + dx, y: y + dy }],
      });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    const area = page.locator('[data-testid=swipe-area]'),
      route = page.locator('[data-testid=route]');
    await swipe(area, -150);
    await expect(route).toHaveText('/homes/demo/organization?tab=shopping');
    scenarios++;
    await swipe(area, 100);
    await expect(route).toHaveText('/homes/demo/organization');
    scenarios++;
    await swipe(area, 0, 80);
    await expect(route).toHaveText('/homes/demo/organization');
    scenarios++;
    await swipe(page.locator('input[name=protected]'), -90);
    await expect(route).toHaveText('/homes/demo/organization');
    scenarios++;
    const trigger = page.locator('.ui-create-panel > summary');
    await trigger.click();
    const panel = page.locator('details.ui-create-panel');
    await expect(panel).toHaveAttribute('open', '');
    await panel.getByLabel('Draft').fill('Preserved draft');
    await panel.getByRole('button', { name: 'Close form' }).click();
    await expect(panel).not.toHaveAttribute('open');
    await expect(trigger).toBeFocused();
    await expect(page.locator('[data-testid=saved]')).toHaveText('0');
    scenarios++;
    await trigger.click();
    await expect(panel.getByLabel('Draft')).toHaveValue('Preserved draft');
    await panel.getByRole('button', { name: 'Save item' }).click();
    await expect(page.locator('[data-testid=saved]')).toHaveText('1');
    scenarios++;
    await page.goto(`${origin}/?primary`);
    await page.locator('[data-testid=swipe-area]').waitFor();
    await swipe(page.locator('[data-testid=swipe-area]'), -150);
    await expect(route).toHaveText('/homes/demo/organization');
    scenarios++;
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
    await page.goto(`${origin}/?loadError=1&tab=absences&from=2026-10-01`);
    const retryUrl = page.url();
    await expect(page.getByRole('link', { name: 'Ausencias', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('alert')).toContainText('Isolated read error component');
    await page.getByRole('link', { name: 'Volver a cargar', exact: true }).click();
    await expect(page).toHaveURL(retryUrl);
    await page.getByRole('link', { name: 'Compra', exact: true }).click();
    await page.waitForURL((url) => url.searchParams.get('tab') === 'shopping');
    await expect(page.getByRole('link', { name: 'Compra', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    scenarios++;
    await page.goto(`${origin}/?calendar=1&month=2026-10`);
    const day = (value) =>
      page.locator('button.calendar-day').filter({ hasText: new RegExp(`^${value}$`) });
    const historyLength = await page.evaluate(() => history.length);
    await day(15).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('day')).toBe('2026-10-15');
    await page.locator('.calendar-filter-panel > summary').click();
    await page.getByLabel('Solo lo mío', { exact: true }).check();
    await page.getByLabel('Gastos', { exact: true }).uncheck();
    await page.reload();
    await expect(page.locator('.calendar-day.selected')).toHaveText('15');
    await page.locator('.calendar-filter-panel > summary').click();
    await expect(page.getByLabel('Solo lo mío', { exact: true })).toBeChecked();
    await expect(page.getByLabel('Gastos', { exact: true })).not.toBeChecked();
    scenarios++;
    await day(20).click();
    await expect(page.locator('.calendar-day.selected')).toHaveText('20');
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
    scenarios++;
    const restoredUrl = page.url();
    const nextMonthLink = page.getByRole('link', { name: 'Mes siguiente', exact: true });
    const nextMonth = await nextMonthLink.getAttribute('href');
    const monthUrl = new URL(nextMonth, origin);
    expect(monthUrl.searchParams.get('mine')).toBe('1');
    expect(monthUrl.searchParams.get('types')).not.toContain('expenses');
    await nextMonthLink.click();
    await page.waitForURL((url) => url.searchParams.get('month') === '2026-11');
    await expect(page.locator('.calendar-day.selected')).toHaveText('1');
    await page.goBack();
    await expect(page.locator('.calendar-day.selected')).toHaveText('20');
    expect(page.url()).toBe(restoredUrl);
    await expect(page.getByLabel('Solo lo mío', { exact: true })).toBeChecked();
    await page.goForward();
    await expect(page.locator('.calendar-day.selected')).toHaveText('1');
    scenarios++;
    expect(errors).toEqual([]);
    await context.close();
  }
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
  ]) {
    const context = await browser.newContext({
      viewport,
      isMobile: viewport.width < 600,
      hasTouch: viewport.width < 600,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const origin = `http://127.0.0.1:${address.port}`;
    const source =
      '/homes/11111111-1111-4111-8111-111111111111/organization?view=all&from=2026-10-01#task-example';
    await page.goto(origin + source);
    const profile = page.getByRole('link', { name: 'Profile', exact: true });
    await expect
      .poll(async () =>
        new URL(await profile.getAttribute('href'), origin).searchParams.get('returnTo'),
      )
      .toBe(source);
    await profile.click();
    await page.waitForURL((url) => url.pathname === '/profile');
    const returnLink = page.getByRole('link', { name: 'Back to previous view' });
    await expect(returnLink).toHaveAttribute('href', source);
    scenarios++;
    await page.getByRole('link', { name: 'Preferences', exact: true }).click();
    await page.waitForURL((url) => url.pathname === '/notifications/preferences');
    await page.reload();
    expect(new URL(await returnLink.getAttribute('href'), origin).pathname).toBe('/profile');
    await returnLink.click();
    await page.waitForURL((url) => url.pathname === '/profile');
    await returnLink.click();
    await page.waitForURL(origin + source);
    scenarios++;
    await page.getByRole('link', { name: 'Notifications', exact: true }).click();
    await page.waitForURL((url) => url.pathname === '/notifications');
    await expect(returnLink).toHaveAttribute('href', source);
    await page.getByRole('link', { name: 'Preferences', exact: true }).click();
    await page.waitForURL((url) => url.pathname === '/notifications/preferences');
    expect(new URL(await returnLink.getAttribute('href'), origin).pathname).toBe('/notifications');
    await page.goBack();
    await expect(returnLink).toHaveAttribute('href', source);
    await page.goBack();
    await page.waitForURL(origin + source);
    await page.goForward();
    await expect(returnLink).toHaveAttribute('href', source);
    scenarios++;
    await page.goto(origin + '/notifications/preferences');
    await expect(returnLink).toHaveAttribute('href', '/notifications');
    await page.goto(origin + '/profile?returnTo=https%3A%2F%2Foutside.invalid');
    await expect(returnLink).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
    expect(errors).toEqual([]);
    scenarios++;
    await context.close();
  }
  for (const viewport of [
    { width: 320, height: 720 },
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
  ]) {
    const context = await browser.newContext({
      viewport,
      isMobile: viewport.width < 600,
      hasTouch: viewport.width < 600,
    });
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const base = `http://127.0.0.1:${address.port}/homes/menus`;
    const capture = async (name) => {
      if (screenshotDirectory)
        await page.screenshot({
          path: path.join(screenshotDirectory, `${viewport.width}-${name}.png`),
          fullPage: true,
          animations: 'disabled',
        });
    };
    await page.goto(`${base}/organization?view=all&from=2026-10-03`);
    const view = page.getByRole('combobox', { name: 'Tareas', exact: true });
    await expect(view.locator('option')).toHaveCount(3);
    await expect(view).toHaveValue('/homes/menus/organization?view=all&from=2026-10-03');
    const labelFits = await view.evaluate((select) => {
      const style = getComputedStyle(select),
        canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      context.font = style.font;
      return (
        context.measureText(select.selectedOptions[0].text).width <=
        select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      );
    });
    expect(labelFits).toBe(true);
    if (viewport.width === 320) {
      const allTabsVisible = await page.locator('nav.section-tabs').evaluate((nav) => {
        const right = nav.getBoundingClientRect().right;
        return Array.from(nav.querySelectorAll('a')).every(
          (link) => link.getBoundingClientRect().right <= right + 1,
        );
      });
      expect(allTabsVisible).toBe(true);
    }
    await capture('tasks-light');
    await page.getByRole('link', { name: 'Configurar tareas', exact: true }).click();
    await page.waitForURL((url) => url.searchParams.get('view') === 'manage');
    await expect(page.getByRole('combobox')).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Configurar tareas', exact: true }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Volver a las tareas', exact: true }).click();
    await expect(view).toHaveValue('/homes/menus/organization?view=all&from=2026-10-03');
    scenarios++;
    await page.goto(`${base}/expenses?tab=balances`);
    const panel = page.locator('.ui-create-panel');
    await expect(panel.getByLabel('Campo de prueba')).not.toBeVisible();
    await panel.locator('summary').focus();
    await page.keyboard.press('Enter');
    await panel.getByLabel('Campo de prueba').fill('Draft retained');
    await panel.getByRole('button', { name: 'Cerrar formulario' }).click();
    await expect(panel.locator('summary')).toBeFocused();
    await panel.locator('summary').click();
    await expect(panel.getByLabel('Campo de prueba')).toHaveValue('Draft retained');
    await panel.getByRole('button', { name: 'Enviar prueba' }).click();
    await expect(page.locator('[data-testid=menu-submitted]')).toHaveText('1');
    scenarios++;
    await page.getByRole('link', { name: 'Historial de cambios', exact: true }).click();
    await page.waitForURL((url) => url.searchParams.get('tab') === 'history');
    await expect(page.locator('nav.section-tabs a')).toHaveCount(3);
    await expect(
      page.getByRole('link', { name: 'Historial de cambios', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await capture('expenses-light');
    await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
    await capture('expenses-dark');
    scenarios++;
    await page.goto(`${base}/community`);
    const filter = page.locator('.section-disclosure');
    await expect(filter.getByLabel('Campo de prueba')).not.toBeVisible();
    await filter.locator('summary').focus();
    await page.keyboard.press('Space');
    await filter.getByLabel('Campo de prueba').fill('Filter retained');
    await filter.locator('summary').click();
    await filter.locator('summary').click();
    await expect(filter.getByLabel('Campo de prueba')).toHaveValue('Filter retained');
    await page.goto(`${base}/community?person=filter-test`);
    await expect(filter.getByLabel('Campo de prueba')).toBeVisible();
    await page.getByRole('link', { name: 'Ajustes de puntos', exact: true }).click();
    await page.waitForURL((url) => url.searchParams.get('tab') === 'reasons');
    await expect(
      page.getByRole('link', { name: 'Ajustes de puntos', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    scenarios++;
    await page.goto(`${base}/chat`);
    const options = page.locator('.message-actions');
    await expect(page.getByRole('button', { name: 'Responder', exact: true })).toBeVisible();
    await expect(options.locator('summary')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Editar', exact: true })).not.toBeVisible();
    await options.locator('summary').focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Reaccionar 👍', exact: true }).click();
    await expect(page.locator('[data-testid=menu-action]')).toHaveText('👍:false');
    await page.getByRole('button', { name: 'Editar', exact: true }).click();
    await expect(page.getByLabel('Compositor de prueba')).toBeFocused();
    await expect(page.locator('[data-testid=menu-action]')).toHaveText('edit');
    await page.getByRole('button', { name: 'Responder', exact: true }).click();
    await expect(page.locator('[data-testid=menu-action]')).toHaveText('reply');
    await page.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await expect(page.locator('[data-testid=menu-action]')).toHaveText('confirmation');
    await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
    await expect
      .poll(() =>
        options.locator('summary').evaluate((element) => {
          const luminance = (rgb) => {
            const channels = rgb
              .match(/[\d.]+/g)
              .slice(0, 3)
              .map((channel) => {
                const value = Number(channel) / 255;
                return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
              });
            return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
          };
          const foreground = luminance(getComputedStyle(element).color);
          const background = luminance(
            getComputedStyle(element.closest('.chat-message')).backgroundColor,
          );
          return (
            (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
          );
        }),
      )
      .toBeGreaterThanOrEqual(4.5);
    await capture('chat-dark');
    scenarios++;
    await page.goto(`${base}/chat?foreign=1`);
    await options.locator('summary').click();
    await expect(page.getByRole('button', { name: 'Editar', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Eliminar', exact: true })).toBeVisible();
    await page.goto(`${base}/chat?pending=1`);
    await options.locator('summary').click();
    for (const button of await page.getByRole('button').all()) await expect(button).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
    expect(errors).toEqual([]);
    scenarios++;
    await context.close();
  }
  console.log(
    `${scenarios} browser scenarios passed: touch tabs, calendar/account history, internal menus, drafts, keyboard actions and dark-mode contrast on mobile and desktop.`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
