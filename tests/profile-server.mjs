// Exercise the real Server Actions with isolated transport dependencies; never contact Supabase.
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('tsx'))('esbuild');
const temp = await mkdtemp(path.join(tmpdir(), 'roomie-profile-server-'));
const stubs = {
  '@/lib/supabase/server': `export async function supabase() { throw new Error('unexpected_transport'); }`,
  '@/lib/i18n/server': `import { es, en } from ${JSON.stringify(path.resolve('src/lib/i18n/dictionaries.ts'))}; export async function i18n() { return { t: globalThis.testLocale === 'en' ? en : es }; }`,
  '@/lib/data': `export async function requireUser() { return { user: { id: 'self' }, db: {
    from() { return { select() { return this; }, eq() { return this; }, async single() { return { data: { avatar_path: null } }; } }; }
  } }; }`,
  'next/headers': `export async function cookies() { throw new Error('unexpected_cookies'); } export async function headers() { throw new Error('unexpected_headers'); }`,
  'next/cache': `export function revalidatePath() {}`,
  'next/navigation': `export function unstable_rethrow() {} export function redirect() { throw new Error('unexpected_redirect'); }`,
};
try {
  await build({
    entryPoints: ['src/app/actions.ts'],
    outfile: path.join(temp, 'actions.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'isolated-transport',
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) =>
            Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'stub' } : undefined,
          );
          build.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
            contents: stubs[args.path],
            loader: 'js',
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
  });
  const { authAction, profileAction } = await import(pathToFileURL(path.join(temp, 'actions.mjs')));
  for (const locale of ['es', 'en']) {
    globalThis.testLocale = locale;
    const mismatch = locale === 'es' ? 'Las contraseñas no coinciden.' : 'Passwords do not match.';
    const invalidImage =
      locale === 'es'
        ? 'Elige una imagen JPG, PNG o WebP de hasta 4 MB.'
        : 'Choose a JPG, PNG or WebP image up to 4 MB.';
    for (const confirmation of ['', 'ABCD', ' abcd']) {
      const form = new FormData();
      form.set('password', 'abcd');
      form.set('password_confirmation', confirmation);
      assert.deepEqual(await authAction('register', {}, form), { error: mismatch });
    }
    for (const [type, bytes] of [
      ['image/png', new Uint8Array(4_000_001)],
      ['image/svg+xml', new TextEncoder().encode('<svg/>')],
      ['image/png', new TextEncoder().encode('not a PNG')],
    ]) {
      const form = new FormData();
      form.set('name', 'Good name');
      form.set('image', new File([bytes], 'photo', { type }));
      assert.deepEqual(await profileAction({}, form), { error: invalidImage });
    }
  }
  console.log(
    'Server password confirmation, image size, MIME and signature regressions passed (es/en)',
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
