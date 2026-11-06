// Isolated component reads; no authenticated backend or business writes.
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
const temp = await mkdtemp(path.resolve('node_modules/.cache/invitation-ui-'));
const stubs = {
  '@/lib/i18n/server': 'export async function i18n() { return globalThis.locale; }',
  '@/lib/data': `export async function requireUser() { return { db: { async rpc(name,args) {
    globalThis.calls.push({name,args}); return globalThis.result;
  } } }; }`,
  'next/link':
    'export default function Link({children,...props}) { return <a {...props}>{children}</a>; }',
  '@/app/actions':
    'export function homeAction() { throw new Error("Must never join during render"); }',
  '@/components/action-form': `export function ActionForm({children,label}) {
    return <form method="post" data-confirm="true">{children}<button>{label}</button></form>;
  }`,
};
let browser;
try {
  await build({
    stdin: {
      contents: `export { default as Join } from './src/app/(account)/homes/join/page';
      export { es,en } from './src/lib/i18n/dictionaries';`,
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
    if (Array.isArray(node)) return Promise.all(node.map(resolve));
    if (!node || typeof node !== 'object' || !node.props) return node;
    if (typeof node.type === 'function') return resolve(node.type(node.props));
    return { ...node, props: { ...node.props, children: await resolve(node.props.children) } };
  };
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
  const code = 'abcdef0123456789abcdef0123456789';
  const name = 'Piso compartido <script> & amigos';
  for (const locale of ['es', 'en']) {
    const t = components[locale];
    globalThis.locale = { locale, t };
    for (const state of [
      'empty',
      'valid',
      'invalid',
      'missing',
      'member',
      'error',
      'array',
      'blank',
    ]) {
      globalThis.calls = [];
      globalThis.result = {
        data: ['valid', 'member'].includes(state)
          ? [{ home_id: 'home-id', home_name: name, already_member: state === 'member' }]
          : [],
        error: state === 'error' ? { message: 'failure' } : null,
      };
      const input =
        state === 'empty'
          ? undefined
          : state === 'invalid'
            ? 'bad'
            : state === 'array'
              ? [code, code]
              : state === 'blank'
                ? ''
                : ` ${code.toUpperCase()} `;
      const html = renderToStaticMarkup(
        await resolve(
          components.Join({
            searchParams: Promise.resolve(input === undefined ? {} : { code: input }),
          }),
        ),
      );
      const previewed = ['valid', 'member', 'missing', 'error'].includes(state);
      assert.deepEqual(
        globalThis.calls,
        previewed ? [{ name: 'preview_invitation', args: { invite_code: code } }] : [],
      );
      for (const width of [320, 390, 768, 1440])
        for (const theme of ['light', 'dark']) {
          const page = await browser.newPage({ viewport: { width, height: 900 } });
          await page.setContent(
            `<html lang="${locale}" data-theme="${theme}"><head><style>${css}</style></head><body><main class="page">${html}</main></body></html>`,
          );
          if (['valid', 'member'].includes(state)) {
            await expect(page.locator('strong')).toHaveText(name);
            await expect(page.getByRole('link', { name: t.cancel, exact: true })).toHaveAttribute(
              'href',
              '/homes',
            );
            if (state === 'valid') {
              await expect(page.getByText(t.invitationPreview, { exact: false })).toBeVisible();
              await expect(page.locator('form[data-confirm]')).toHaveCount(1);
              await expect(page.locator('input[name="code"]')).toHaveAttribute('type', 'hidden');
              await expect(page.locator('input[name="code"]')).toHaveValue(code);
              await expect(page.getByRole('button', { name: t.join, exact: true })).toBeVisible();
            } else {
              await expect(
                page.getByText(t.invitationAlreadyMember, { exact: false }),
              ).toBeVisible();
              await expect(page.locator('form')).toHaveCount(0);
              await expect(page.getByRole('link', { name: t.openHome })).toHaveAttribute(
                'href',
                '/homes/home-id',
              );
            }
          } else {
            await expect(page.locator('form')).toHaveAttribute('method', 'get');
            await expect(page.locator('form')).toHaveAttribute('action', '/homes/join');
            await expect(page.getByRole('button', { name: t.checkInvitation })).toBeVisible();
            if (state !== 'empty')
              await expect(page.getByRole('alert')).toHaveText(
                state === 'error' ? t.requestError : t.invalidInvitation,
              );
            else await expect(page.getByRole('alert')).toHaveCount(0);
          }
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
            false,
          );
          await page.close();
        }
    }
  }
} finally {
  await browser?.close();
  await rm(temp, { recursive: true, force: true });
}
