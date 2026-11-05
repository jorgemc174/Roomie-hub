// Component regression checks with isolated reads, not an authenticated backend E2E.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium, expect } from '@playwright/test';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('tsx'))('esbuild');
await mkdir('node_modules/.cache', { recursive: true });
const temp = await mkdtemp(path.resolve('node_modules/.cache/pa-ui-'));
const stubs = {
  '@/lib/data': `export async function getProfile() { return globalThis.profile; }
    export async function getHome() { return globalThis.home; }
    export async function getMembers() { return globalThis.members; }
    export async function requireUser() { return { user: { id: 'self' }, db: { from() { return { select() { return this; }, eq() { return this; }, async single() { return { data: { code: 'test-only' } }; } }; } } }; }
    export async function signedImage(bucket, path) { globalThis.signedReads.push([bucket, path]); return path ? '/private-test-image.png' : null; }`,
  '@/lib/i18n/server': `export async function i18n() { return globalThis.locale; }`,
  'next/link': `export default function Link({children, ...props}) { return <a {...props}>{children}</a>; }`,
  'next/navigation': `export function usePathname() { return '/homes/test'; }`,
  './navigation-hint': `export function NavigationHint() { return null; }`,
  './account-navigation': `export { default as AccountLink } from 'next/link';`,
  '@/features/notifications/inbox': `export function NotificationBell() { return null; }`,
  '@/components/action-form': `export function ActionForm({children}) { return <div>{children}</div>; }`,
  '@/app/actions': `export function homeAction() {}`,
  '@/features/expenses/actions': `export function financeAction() {}`,
};
// Summary contents and interactive controls are outside these presentation checks.
for (const [name, symbol] of [
  ['@/features/community/summary', 'CommunitySummary'],
  ['@/features/expenses/summary', 'ExpenseSummary'],
  ['@/features/organization/summary', 'OrganizationSummary'],
  ['@/components/ui/upcoming-event', 'UpcomingEvent'],
  ['@/components/ui/copy-button', 'CopyButton'],
  ['@/components/currency-select', 'CurrencySelect'],
])
  stubs[name] = `export function ${symbol}() { return null; }`;
let browser;
try {
  await build({
    stdin: {
      contents: `export { Topbar } from './src/components/topbar';
      export { default as HomePage } from './src/app/(workspace)/homes/[homeId]/page';
      export { default as Settings } from './src/app/(workspace)/homes/[homeId]/settings/page';
      export { Navigation } from './src/components/navigation';
      export { es, en } from './src/lib/i18n/dictionaries';`,
      resolveDir: process.cwd(),
    },
    outfile: path.join(temp, 'components.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    jsx: 'automatic',
    plugins: [
      {
        name: 'isolated-reads',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) =>
            Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'stub' } : undefined,
          );
          builder.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
            contents: stubs[args.path],
            loader: 'tsx',
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
  });
  const components = await import(pathToFileURL(path.join(temp, 'components.mjs')));
  const resolve = async (node) => {
    node = await node;
    if (Array.isArray(node)) {
      const children = await Promise.all(node.map(resolve));
      return children.map((child, index) =>
        child?.props && child.key == null ? { ...child, key: String(index) } : child,
      );
    }
    if (!node || typeof node !== 'object' || !node.props) return node;
    if (typeof node.type === 'function') return resolve(node.type(node.props));
    return { ...node, props: { ...node.props, children: await resolve(node.props.children) } };
  };
  process.env.NEXT_PUBLIC_SITE_URL = 'https://example.test';
  const css = (
    await Promise.all(
      ['src/app/globals.css', 'src/styles/system.css'].map((file) => readFile(file, 'utf8')),
    )
  )
    .join('\n')
    .replaceAll(/@import[^;]+;/g, '');
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium-browser',
  });
  for (const locale of ['es', 'en'])
    for (const photo of [false, true]) {
      const t = components[locale];
      globalThis.locale = { t, locale };
      globalThis.profile = { name: 'María del Mar', avatar_path: photo ? 'self/photo.png' : null };
      globalThis.home = {
        name: 'Piso con nombre largo para comprobar el espacio disponible',
        image_path: photo ? 'home/photo.png' : null,
        currency: 'EUR',
        week_starts_on: 1,
        timezone: 'Europe/Madrid',
      };
      globalThis.members = [
        { user_id: 'self', joined_at: '2026-09-15T10:00:00Z', profiles: globalThis.profile },
        {
          user_id: 'other',
          joined_at: '2026-10-05T10:00:00Z',
          profiles: { name: 'Ana López', avatar_path: null },
        },
      ];
      globalThis.signedReads = [];
      const topbar = renderToStaticMarkup(
        await resolve(components.Topbar({ t, homeId: 'test', homeName: globalThis.home.name })),
      );
      const accountTopbar = renderToStaticMarkup(await resolve(components.Topbar({ t })));
      assert.ok(accountTopbar.includes('María del Mar'));
      const home = renderToStaticMarkup(
        await resolve(components.HomePage({ params: Promise.resolve({ homeId: 'test' }) })),
      );
      const settings = renderToStaticMarkup(
        await resolve(components.Settings({ params: Promise.resolve({ homeId: 'test' }) })),
      );
      assert.ok(
        globalThis.signedReads.some(
          ([bucket, key]) => bucket === 'avatars' && key === globalThis.profile.avatar_path,
        ),
      );
      for (const width of [320, 390, 768, 1440])
        for (const theme of ['light', 'dark']) {
          const page = await browser.newPage({ viewport: { width, height: 1000 } });
          for (const [screen, html] of [
            ['home', home],
            ['settings', settings],
          ]) {
            await page.setContent(
              `<html lang="${locale}" data-theme="${theme}"><head><style>${css}</style></head><body><div class="app-shell"><aside class="sidebar">${renderToStaticMarkup(components.Navigation({ homeId: 'test', t }))}</aside><div class="workspace">${topbar}<main class="page">${html}</main></div></div></body></html>`,
            );
            const avatar = page.locator('.topbar-action .avatar');
            await expect(avatar).toBeVisible();
            if (!photo) await expect(avatar).toHaveText('MM');
            else await expect(avatar).toHaveAttribute('src', '/private-test-image.png');
            if (width === 1440) await expect(page.locator('.topbar-profile-name')).toBeVisible();
            expect(
              await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
            ).toBe(false);
            if (screen === 'home') {
              await expect(page.locator('h1')).toHaveText(globalThis.home.name);
              await expect(
                page.getByText(`${t.greeting}, María del Mar`, { exact: true }),
              ).toBeVisible();
              await expect(page.locator('.home-sections a')).toHaveCount(6);
              const links = await page
                .locator('.home-sections a')
                .evaluateAll((links) => links.map((a) => a.getAttribute('href')));
              assert.deepEqual(
                links,
                await page
                  .locator('.side-nav a')
                  .evaluateAll((links) => links.map((a) => a.getAttribute('href'))),
              );
            } else {
              await expect(
                page.getByRole('heading', { name: t.members, exact: true }),
              ).toBeVisible();
              await expect(page.locator('.section-heading .badge')).toHaveText('2');
              await expect(
                page.getByText(`María del Mar · ${t.you}`, { exact: true }),
              ).toBeVisible();
              await expect(page.getByText('Ana López', { exact: true })).toBeVisible();
              const dates = await page.locator('.member-row small').allTextContents();
              assert.ok(dates[0].includes('15') && dates[0].includes('2026'));
            }
          }
          if (
            process.env.PA_UI_SCREENSHOTS_DIR &&
            locale === 'es' &&
            !photo &&
            [390, 1440].includes(width)
          ) {
            await mkdir(process.env.PA_UI_SCREENSHOTS_DIR, { recursive: true });
            await page.screenshot({
              path: path.join(process.env.PA_UI_SCREENSHOTS_DIR, `settings-${width}-${theme}.png`),
              fullPage: true,
            });
          }
          await page.close();
        }
    }
  console.log(
    'Identity, private-image reads, greeting, shared navigation and housemates: 64 screen variants passed',
  );
} finally {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
}
