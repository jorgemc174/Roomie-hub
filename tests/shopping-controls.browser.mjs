// Isolated browser regression for real shopping controls. No Supabase fixtures or requests.
import { createRequire } from 'node:module';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('tsx'))('esbuild');
const temp = await mkdtemp(path.join(tmpdir(), 'roomie-shopping-'));
const outfile = path.join(temp, 'fixture.js');
await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'tsx',
    contents: `
      import { createRoot } from 'react-dom/client';
      import { useState } from 'react';
      import { ShoppingAnchor, DeleteShoppingList, ShoppingListNameForm } from './src/features/organization/shopping-controls';
      import { AccountReturn } from './src/components/account-navigation';
      import { OptionsMenu } from './src/components/ui/options-menu';
      import { organizationMessages } from './src/features/organization/messages';
      function App() {
        const t = organizationMessages(new URLSearchParams(location.search).get('locale') === 'en' ? 'en' : 'es');
        const [removed, setRemoved] = useState(false);
        const action = async () => { window.nameCalls = (window.nameCalls || 0) + 1; return { success: t.saved }; };
        if (location.pathname !== '/') return <main><AccountReturn label={t.cancel === 'Cancelar' ? 'Volver' : 'Back'} /><h1>Account</h1></main>;
        return <main className="organization"><div style={{ height: '110vh' }} />
          {!removed && <section id="shopping-new" tabIndex={-1} className="panel shopping-list">
            <h2>Groceries</h2>
            <div id="create"><ShoppingListNameForm action={action} t={t} /></div>
            <div id="rename"><ShoppingListNameForm action={action} t={t} list={{id:'new',name:'Groceries'}} /></div>
            <div id="product"><ShoppingListNameForm action={action} t={t} itemListId="new" /></div>
            <OptionsMenu label={t.options}>
              <DeleteShoppingList listId="new" t={t} action={async (_state, form) => {
                if (form.get('list_id') !== 'new') return { error: 'wrong list' };
                window.deletions = (window.deletions || 0) + 1;
                setRemoved(true); return { success: t.saved };
              }} />
            </OptionsMenu>
          </section>}
          <ShoppingAnchor createdId="new" />
        </main>;
      }
      createRoot(document.getElementById('root')).render(<App />);`,
  },
  outfile,
  bundle: true,
  jsx: 'automatic',
  platform: 'browser',
  plugins: [
    {
      name: 'next-stubs',
      setup(builder) {
        builder.onResolve({ filter: /^next\/(link|navigation)$/ }, (args) => ({
          path: args.path,
          namespace: 'stub',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
          contents:
            args.path === 'next/link'
              ? 'export default function Link({children,...props}) { return <a {...props}>{children}</a>; }'
              : 'export const usePathname = () => location.pathname; export const useSearchParams = () => new URLSearchParams(location.search);',
          loader: 'tsx',
          resolveDir: process.cwd(),
        }));
      },
    },
  ],
  define: { 'process.env.NODE_ENV': '"production"' },
});
const js = await readFile(outfile);
const css = (
  await Promise.all(
    ['src/app/globals.css', 'src/styles/system.css'].map((file) => readFile(file, 'utf8')),
  )
)
  .join('\n')
  .replaceAll(/@import[^;]+;/g, '');
const server = createServer((req, res) => {
  if (req.url === '/fixture.js') {
    res.setHeader('Content-Type', 'application/javascript');
    return res.end(js);
  }
  if (req.url === '/fixture.css') {
    res.setHeader('Content-Type', 'text/css');
    return res.end(css);
  }
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Content-Type', 'text/html');
  res.end(
    `<!doctype html><html lang="${url.searchParams.get('locale') === 'en' ? 'en' : 'es'}" data-theme="${url.searchParams.get('theme') === 'dark' ? 'dark' : 'light'}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`,
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
let scenarios = 0;
try {
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium-browser',
  });
  for (const width of [320, 390, 768, 1440])
    for (const theme of ['light', 'dark'])
      for (const locale of ['es', 'en']) {
        const page = await browser.newPage({
          viewport: { width, height: 900 },
          reducedMotion: 'reduce',
        });
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(
          `http://127.0.0.1:${server.address().port}/?theme=${theme}&locale=${locale}`,
        );
        const list = page.locator('#shopping-new');
        await expect(list).toBeFocused();
        await expect(list).toBeInViewport();
        const options = page.getByLabel(locale === 'es' ? 'Opciones' : 'Options', { exact: true });
        const create = page.locator('#create');
        await create.locator('input[name="name"]').fill('   ');
        await create.getByRole('button').click();
        await expect(create.locator('input[name="name"]')).toHaveAttribute('aria-invalid', 'true');
        await expect(create.getByRole('alert')).toContainText(
          locale === 'es' ? 'para la lista' : 'for the list',
        );
        const product = page.locator('#product');
        await product.locator('input[name="name"]').fill('   ');
        await product.getByRole('button').click();
        await expect(product.getByRole('alert')).toContainText(
          locale === 'es' ? 'para el producto' : 'for the product',
        );
        const rename = page.locator('#rename');
        await rename.locator('summary').click();
        await rename.locator('input[name="name"]').fill('   ');
        await rename.getByRole('button').click();
        await expect(rename.locator('details')).not.toHaveAttribute('open');
        await expect(rename.getByRole('status')).toBeVisible();
        await expect(rename.locator('input[name="name"]')).toHaveValue('Groceries');
        expect(await page.evaluate(() => window.nameCalls || 0)).toBe(0);
        await options.click();
        const prompt = page.getByText(
          locale === 'es' ? 'Eliminar lista y sus productos' : 'Delete list and its products',
          { exact: true },
        );
        await prompt.click();
        const cancel = page.getByRole('button', {
          name: locale === 'es' ? 'Cancelar' : 'Cancel',
          exact: true,
        });
        const remove = page.getByRole('button', {
          name: locale === 'es' ? 'Confirmar eliminación' : 'Confirm deletion',
          exact: true,
        });
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(cancel).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).not.toBeVisible();
        await expect(prompt).toBeFocused();
        await prompt.click();
        await expect(cancel).toBeVisible();
        await expect(remove).toBeVisible();
        await expect(
          page.getByText(
            locale === 'es'
              ? '¿Eliminar esta lista y todos sus productos?'
              : 'Delete this list and all its products?',
            { exact: true },
          ),
        ).toBeVisible();
        const dir = process.env.SHOPPING_SCREENSHOTS_DIR;
        if (dir) {
          await mkdir(dir, { recursive: true });
          await page.screenshot({
            path: path.join(dir, `${width}-${theme}-${locale}.png`),
            fullPage: true,
          });
        }
        await cancel.click();
        await expect(list).toBeVisible();
        await expect(prompt).toBeFocused();
        await expect(remove).not.toBeVisible();
        expect(await page.evaluate(() => window.deletions || 0)).toBe(0);
        await prompt.click();
        await remove.click();
        await expect(list).toHaveCount(0);
        expect(await page.evaluate(() => window.deletions)).toBe(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        expect(errors).toEqual([]);
        const base = `http://127.0.0.1:${server.address().port}`;
        await page.goto(`${base}/profile?theme=${theme}&locale=${locale}`);
        const back = page.getByRole('link', { name: locale === 'es' ? 'Volver' : 'Back' });
        await expect(back).toBeVisible();
        await expect(back).toHaveClass(/back-link/);
        await back.click();
        await expect(page).toHaveURL(`${base}/?theme=${theme}&locale=${locale}`);
        const direct = await browser.newPage({ viewport: { width, height: 900 } });
        await direct.goto(`${base}/profile?locale=${locale}`);
        await direct.getByRole('link').click();
        await expect(direct).toHaveURL(`${base}/homes`);
        await direct.close();
        const preferences = await browser.newPage({ viewport: { width, height: 900 } });
        await preferences.goto(`${base}/notifications/preferences?locale=${locale}`);
        await expect(preferences.getByRole('link')).toHaveAttribute('href', '/homes');
        await preferences.getByRole('link').click();
        await expect(preferences).toHaveURL(`${base}/homes`);
        await preferences.close();
        scenarios++;
        await page.close();
      }
  console.log(
    `${scenarios} shopping browser scenarios passed (focus, confirmation, cancel and delete).`,
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
