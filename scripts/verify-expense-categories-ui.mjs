// Isolated browser verification of production components; no remote accounts or business writes.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, readdir, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('tsx'))('esbuild');
const root = process.cwd();
const temp = path.join(root, 'test-results/expense-categories');
const screenshots = process.env.EXPENSE_SCREENSHOTS_DIR || '/tmp/claude-1000/verif';
await mkdir(temp, { recursive: true });
await mkdir(screenshots, { recursive: true });
const fixture = path.join(root, 'tests/fixtures/expenses/categories.tsx');
await build({
  entryPoints: [fixture],
  outfile: path.join(temp, 'server.cjs'),
  bundle: true,
  platform: 'node',
  packages: 'external',
});
const { ExpenseCategoriesFixture, categoryColors } = require(path.join(temp, 'server.cjs'));
const client = await build({
  stdin: {
    contents: `import { hydrateRoot } from 'react-dom/client'; import { createElement } from 'react'; import { ExpenseCategoriesFixture } from ${JSON.stringify(fixture)}; hydrateRoot(document.getElementById('root'), createElement(ExpenseCategoriesFixture, window.fixtureProps));`,
    resolveDir: root,
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  platform: 'browser',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const chunks = await readdir('.next/static/chunks');
const css = (
  await Promise.all(
    chunks
      .filter((f) => f.endsWith('.css'))
      .map((f) => readFile(`.next/static/chunks/${f}`, 'utf8')),
  )
).join('\n');
let locale = 'es';
const server = createServer((req, res) => {
  if (req.url === '/fixture.js') {
    res.setHeader('Content-Type', 'text/javascript');
    return res.end(client.outputFiles[0].text);
  }
  if (req.url === '/fixture.css') {
    res.setHeader('Content-Type', 'text/css');
    return res.end(css);
  }
  const url = new URL(req.url, 'http://localhost');
  const props = { locale, category: url.searchParams.get('category') || undefined };
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(
    `<!doctype html><html lang="${locale}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root">${renderToString(createElement(ExpenseCategoriesFixture, props))}</div><script>window.fixtureProps=${JSON.stringify(props)}</script><script src="/fixture.js"></script></body></html>`,
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium-browser',
});
let scenarios = 0;
try {
  for (locale of ['es', 'en'])
    for (const width of [320, 390, 768, 1440])
      for (const theme of ['light', 'dark']) {
        const context = await browser.newContext({
          viewport: { width, height: 1000 },
          colorScheme: theme,
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(`${origin}/?page=2`);
        await page.evaluate((value) => {
          document.documentElement.dataset.theme = value;
        }, theme);
        await expect(page.getByTestId('total')).toContainText('75');
        await expect(page.locator('noscript button')).not.toBeVisible();
        await expect(page.locator('.expense-category-track')).toHaveCount(2);
        const sizes = await page
          .locator('.expense-category-track')
          .evaluateAll((tracks) =>
            tracks.map(
              (track) =>
                track.firstElementChild.getBoundingClientRect().width /
                track.getBoundingClientRect().width,
            ),
          );
        expect(Math.abs(sizes[0] - 0.6667)).toBeLessThan(0.001);
        expect(Math.abs(sizes[1] - 0.3333)).toBeLessThan(0.001);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        // Resolve all palette colors in each theme and verify WCAG AA contrast.
        const palette = await page.evaluate((values) => {
          const el = document.createElement('span');
          document.body.append(el);
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          const ctx = canvas.getContext('2d');
          function rgb(color) {
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, 1, 1);
            return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
          }
          function luminance(color) {
            return rgb(color)
              .map((v) => {
                const n = v / 255;
                return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
              })
              .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
          }
          el.style.color = 'var(--surface)';
          const surface = luminance(getComputedStyle(el).color);
          const result = values.map((value) => {
            el.style.color = value;
            const color = getComputedStyle(el).color;
            const l = luminance(color);
            return {
              rgb: rgb(color).join(','),
              contrast: (Math.max(l, surface) + 0.05) / (Math.min(l, surface) + 0.05),
            };
          });
          el.remove();
          return result;
        }, Object.values(categoryColors));
        expect(new Set(palette.map((c) => c.rgb)).size).toBe(12);
        for (const color of palette) expect(color.contrast).toBeGreaterThanOrEqual(4.5);
        // Match chart and list computed colors; text is always present as well.
        const colors = await page
          .locator('.expense-category')
          .evaluateAll((els) => els.map((el) => getComputedStyle(el).color));
        expect(colors[0]).toBe(colors[2]);
        expect(colors[1]).toBe(colors[3]);
        await page.screenshot({
          path: `${screenshots}/f4b_${locale}_${width}_${theme}.png`,
          fullPage: true,
        });
        await page.locator('select[name=category]').selectOption('groceries');
        await page.waitForURL('**/?tab=expenses&category=groceries');
        await expect(page.getByTestId('total')).toContainText('25');
        await expect(page.locator('.expense-category-track')).toHaveCount(1);
        await expect(page.locator('.expense-category-track > span')).toHaveAttribute(
          'style',
          /width:\s*100%/,
        );
        await page.locator('select[name=category]').selectOption('');
        await page.waitForURL('**/?tab=expenses&category=');
        await expect(page.getByTestId('total')).toContainText('75');
        expect(errors).toEqual([]);
        await context.close();
        scenarios++;
      }
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(origin);
  await page.locator('select[name=category]').selectOption('groceries');
  await page.getByRole('button', { name: 'Apply filter' }).click();
  await page.waitForURL('**/?tab=expenses&category=groceries');
  await expect(page.getByTestId('total')).toContainText('25');
  await page.locator('select[name=category]').selectOption('');
  await page.getByRole('button', { name: 'Apply filter' }).click();
  await expect(page.getByTestId('total')).toContainText('75');
  await context.close();
  console.log(`${scenarios} component scenarios passed, plus filter and reset without JavaScript.`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
