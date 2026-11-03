// Opt-in integration checks against a real development account. No admin keys,
// fixtures or submitted business operations. Normal page RPCs still run.
// Run a built app first; no messages, payments or task completions are submitted.
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
if (!process.env.E2E_USER_EMAIL || !process.env.E2E_USER_PASSWORD)
  throw new Error('Configure E2E_USER_EMAIL and E2E_USER_PASSWORD securely before running.');
const output = 'test-results/authenticated-ui';
await mkdir(output, { recursive: true });
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium',
  ...(proxy ? { proxy: { server: proxy, bypass: 'localhost,127.0.0.1' } } : {}),
});
const results = [];
try {
  for (const variant of [
    { width: 320, height: 740, theme: 'light' },
    { width: 390, height: 844, theme: 'dark' },
    { width: 768, height: 1024, theme: 'light' },
    { width: 1440, height: 1000, theme: 'dark' },
  ]) {
    const context = await browser.newContext({
      viewport: { width: variant.width, height: variant.height },
      hasTouch: variant.width < 1000,
      isMobile: variant.width < 600,
    });
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (error) => errors.push(error.name));
    await page.goto(base + '/login', { waitUntil: 'networkidle' });
    await page.getByLabel('Correo electrónico', { exact: true }).fill(process.env.E2E_USER_EMAIL);
    await page.getByLabel('Contraseña', { exact: true }).fill(process.env.E2E_USER_PASSWORD);
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await page.waitForURL((url) => url.pathname === '/homes');
    const home = await page.locator('.home-card').first().getAttribute('href');
    if (!home) throw new Error('The development account needs an accessible test home.');
    await context.addCookies([
      { name: 'theme', value: variant.theme, url: base },
      { name: 'locale', value: 'es', url: base },
    ]);
    const visit = async (path) => {
      const response = await page.goto(base + path, { waitUntil: 'networkidle' });
      expect(response.status()).toBe(200);
      await expect(page.locator('html')).toHaveAttribute('data-theme', variant.theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(
        false,
      );
      await expect(page.locator('main h1')).toHaveCount(1);
    };
    const visibleAboveNavigation = async (locator) => {
      await expect(locator).toBeVisible();
      return locator.evaluate((el) => {
        const nav = document.querySelector('.side-nav');
        const limit =
          nav && getComputedStyle(nav).position === 'fixed'
            ? nav.getBoundingClientRect().top
            : innerHeight;
        return el.getBoundingClientRect().bottom <= limit;
      });
    };
    await visit(home);
    await expect(page.locator('.side-nav a')).toHaveCount(6);
    await expect(page.getByRole('link', { name: 'Invitar compañeros', exact: true })).toBeVisible();
    if (variant.width === 768) {
      expect(
        await page.locator('main').evaluate((el) => el.getBoundingClientRect().left),
      ).toBeLessThan(50);
    }
    results.push({
      width: variant.width,
      theme: variant.theme,
      check: 'workspace-navigation',
      passed: true,
    });
    await visit(home + '/organization');
    const count = await page.locator('.task-row').count();
    if (count) {
      await expect(page.locator('.task-period-heading time').first()).toBeVisible();
      await expect(page.locator('.task-row .task-occurrence-date time').first()).toBeVisible();
      const ids = await page.locator('.task-row').evaluateAll((rows) => rows.map((r) => r.id));
      expect(new Set(ids).size).toBe(count);
      await page.goto(base + home + '/organization#' + ids[0], { waitUntil: 'networkidle' });
      expect(
        await visibleAboveNavigation(page.locator('.task-row .task-occurrence-date').first()),
      ).toBe(true);
      await page.locator('.task-row details summary').first().click();
      await expect(page.locator('.task-row details').first()).toHaveAttribute('open', '');
    }
    const view = page.getByRole('combobox', { name: 'Tareas', exact: true });
    const all = await view.locator('option').all();
    await view.selectOption(await all[1].getAttribute('value'));
    await page.waitForURL((url) => url.searchParams.get('view') === 'all');
    const from = new URL(page.url()).searchParams.get('from');
    await page.getByRole('link', { name: 'Configurar tareas', exact: true }).click();
    await page.waitForURL((url) => url.searchParams.get('view') === 'manage');
    await page.getByRole('link', { name: 'Volver a las tareas', exact: true }).click();
    await page.waitForURL((url) => url.searchParams.get('view') === 'all');
    expect(new URL(page.url()).searchParams.get('from')).toBe(from);
    results.push({
      width: variant.width,
      theme: variant.theme,
      check: 'task-periods-and-return',
      passed: true,
      visibleOccurrences: count,
    });
    await visit(home + '/community');
    expect(await visibleAboveNavigation(page.locator('#create-rating > summary'))).toBe(true);
    await page.locator('#create-rating > summary').click();
    await expect(page.locator('#create-rating')).toHaveAttribute('open', '');
    await page.locator('#create-rating .ui-create-close').click();
    await expect(page.locator('#create-rating > summary')).toBeFocused();
    results.push({
      width: variant.width,
      theme: variant.theme,
      check: 'community-action',
      passed: true,
    });
    await visit(home + '/chat');
    const empty = await page.locator('.chat-shell.is-empty').count();
    if (empty) {
      expect(await visibleAboveNavigation(page.locator('.chat-composer textarea'))).toBe(true);
      expect(
        await visibleAboveNavigation(page.getByRole('button', { name: 'Enviar', exact: true })),
      ).toBe(true);
      await expect(
        page.getByRole('button', { name: 'Mensajes anteriores', exact: true }),
      ).toHaveCount(0);
    }
    await page
      .locator('.chat-composer textarea')
      .fill('Borrador local de comprobación; no se envía.');
    await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeEnabled();
    await page.screenshot({
      path: `${output}/${variant.width}-${variant.theme}-chat.png`,
      fullPage: true,
      animations: 'disabled',
    });
    results.push({
      width: variant.width,
      theme: variant.theme,
      check: empty ? 'empty-chat-composer' : 'chat-composer',
      passed: true,
    });
    await visit(home + '/calendar');
    const day = page.locator('.calendar-day:not([disabled])').first();
    await day.click();
    const selected = new URL(page.url()).searchParams.get('day');
    await page.reload({ waitUntil: 'networkidle' });
    expect(new URL(page.url()).searchParams.get('day')).toBe(selected);
    await expect(page.locator('.calendar-day[aria-pressed=true]')).toHaveCount(1);
    results.push({
      width: variant.width,
      theme: variant.theme,
      check: 'calendar-deep-link',
      passed: true,
    });
    await visit(home + '/expenses?create=expense');
    await expect(page.locator('#new-expense')).toHaveAttribute('open', '');
    await page.locator('#new-expense .ui-create-close').click();
    await expect(page.locator('#new-expense > summary')).toBeFocused();
    expect(errors).toEqual([]);
    results.push({
      width: variant.width,
      theme: variant.theme,
      check: 'expense-form-and-browser-errors',
      passed: true,
    });
    console.log(`${variant.width}px ${variant.theme}: 6 authenticated checks passed`);
    await context.close();
  }
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
console.log(`${results.length} authenticated UI checks passed; no business operations submitted.`);
