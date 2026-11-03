// Isolated component integration: no accounts, sessions or backend responses are injected.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('tsx'))('esbuild');
const temp = await mkdtemp(path.join(tmpdir(), 'roomie-profile-'));
await build({
  entryPoints: ['tests/fixtures/profile/app.tsx'],
  outfile: path.join(temp, 'app.js'),
  bundle: true,
  platform: 'browser',
  alias: { '@/app/actions': path.resolve('tests/fixtures/profile/actions.ts') },
  define: { 'process.env.NODE_ENV': '"production"' },
});
const js = await readFile(path.join(temp, 'app.js'));
const chunks = await readdir('.next/static/chunks').catch(() => []);
const css = (
  await Promise.all(
    chunks
      .filter((file) => file.endsWith('.css'))
      .map((file) => readFile(`.next/static/chunks/${file}`, 'utf8')),
  )
).join('\n');
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/app.js' ? 'application/javascript' : 'text/html');
  res.end(
    req.url === '/app.js'
      ? js
      : `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`,
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
let scenarios = 0;
try {
  for (const locale of ['es', 'en'])
    for (const width of [320, 390, 768, 1440])
      for (const theme of ['light', 'dark']) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        const origin = `http://127.0.0.1:${server.address().port}`;
        await page.goto(`${origin}/?locale=${locale}`);
        await page.locator('html').evaluate((element, theme) => {
          element.dataset.theme = theme;
        }, theme);
        const form = page.locator('form').first(),
          name = form.locator('[name=name]'),
          photo = form.locator('[name=image]');
        const cancel = form.getByRole('button', {
          name: locale === 'es' ? 'Cancelar' : 'Cancel',
          exact: true,
        });
        const save = form.getByRole('button', {
          name: locale === 'es' ? 'Guardar cambios' : 'Save changes',
          exact: true,
        });
        await expect(form.locator('input[type=email]')).toHaveValue('self@example.test');
        await expect(form.locator('input[type=email]')).toHaveAttribute('readonly', '');
        await expect(form.getByRole('img')).toHaveText('MS');
        await name.fill('Changed Name');
        await form.locator('[name=locale]').selectOption(locale === 'es' ? 'en' : 'es');
        await form.locator('[name=theme]').selectOption('dark');
        await photo.setInputFiles({
          name: 'photo.png',
          mimeType: 'image/png',
          buffer: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
            'base64',
          ),
        });
        await expect(form.locator('img')).toHaveAttribute('src', /^blob:/);
        await expect(page.locator('html')).not.toHaveAttribute('data-submissions');
        const beforeUnload = () =>
          page.evaluate(() => {
            const event = new Event('beforeunload', { cancelable: true });
            window.dispatchEvent(event);
            return event.defaultPrevented;
          });
        expect(await beforeUnload()).toBe(true);
        page.once('dialog', (dialog) => dialog.dismiss());
        await page.getByRole('link', { name: 'Leave' }).click();
        expect(new URL(page.url()).pathname).toBe('/');
        await cancel.click();
        await expect(name).toHaveValue('María Sol');
        await expect(form.locator('[name=locale]')).toHaveValue(locale);
        await expect(form.locator('[name=theme]')).toHaveValue('light');
        expect(await photo.evaluate((element) => element.files.length)).toBe(0);
        expect(await beforeUnload()).toBe(false);
        await form.locator('[name=remove_image]').check();
        await cancel.click();
        await expect(form.locator('[name=remove_image]')).not.toBeChecked();
        for (const [mimeType, size] of [
          ['application/pdf', 100],
          ['image/png', 4_000_001],
        ]) {
          await photo.setInputFiles({ name: 'bad-file', mimeType, buffer: Buffer.alloc(size) });
          await expect(form.getByRole('alert')).toContainText('4 MB');
          await save.click();
          await expect(page.locator('html')).not.toHaveAttribute('data-submissions');
          await cancel.click();
        }
        await name.fill('Fail save');
        await save.click();
        await expect(form.getByRole('alert')).toHaveText('Save failed');
        await expect(name).toHaveValue('Fail save');
        expect(await beforeUnload()).toBe(true);
        await cancel.click();
        await name.fill('New saved name');
        await save.click();
        await expect(form.getByRole('status')).toContainText('Saved');
        expect(await beforeUnload()).toBe(false);
        await name.fill('Another draft');
        await cancel.click();
        await expect(name).toHaveValue('New saved name');
        await photo.setInputFiles({
          name: 'saved.png',
          mimeType: 'image/png',
          buffer: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
            'base64',
          ),
        });
        const savedPreview = await form.locator('img').getAttribute('src');
        await save.click();
        await expect(form.getByRole('status')).toContainText('Saved');
        await expect(form.locator('img')).toHaveAttribute('src', savedPreview);
        expect(await beforeUnload()).toBe(false);
        await form.locator('[name=remove_image]').check();
        await expect(form.locator('img')).toHaveCount(0);
        await cancel.click();
        await expect(form.locator('img')).toHaveAttribute('src', savedPreview);
        const register = page.locator('#register');
        await register.locator('[name=password]').fill('abcd');
        await register.locator('[name=password_confirmation]').fill('different');
        await register.getByRole('button', { name: 'Register', exact: true }).click();
        await expect(register.locator('[name=password_confirmation]')).toHaveAttribute(
          'aria-invalid',
          'true',
        );
        await expect(page.locator('html')).not.toHaveAttribute('data-registered');
        await register.locator('[name=password_confirmation]').fill('abcd');
        await register.locator('[name=password]').fill('changed');
        await expect(register.locator('[name=password_confirmation]')).toHaveAttribute(
          'aria-invalid',
          'true',
        );
        await register.locator('[name=password_confirmation]').fill('changed');
        await register.getByRole('button', { name: 'Register', exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('data-registered', 'true');
        if (css)
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
        expect(errors).toEqual([]);
        scenarios++;
        await page.close();
      }
  console.log(`${scenarios} profile/registration browser scenarios passed`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
