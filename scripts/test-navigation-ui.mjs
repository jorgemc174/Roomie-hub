// Browser integration tests for touch gestures, calendar state and existing inline forms, without remote accounts.
import { createRequire } from 'node:module';
// Reuse the bundler already supplied by the locked tsx development dependency.
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('tsx'))('esbuild');
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
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
  console.log(
    `${scenarios} browser scenarios passed: Android touch emulation, portrait/landscape, tab directions, scroll/input exclusions, no global module swipe, unchanged form focus, drafts, submit and calendar reload/month history without extra day entries.`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
