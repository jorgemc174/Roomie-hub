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
process.env.NEXT_PUBLIC_SITE_URL = 'https://local.test';
const stubs = {
  '@/lib/supabase/config': `export function config() { return { url: 'https://local.test', key: 'test-only' }; }`,
  '@/lib/supabase/server': `export async function supabase() { return globalThis.authDb; }`,
  '@/lib/i18n/server': `import { es, en } from ${JSON.stringify(path.resolve('src/lib/i18n/dictionaries.ts'))}; export async function i18n() { return { t: globalThis.testLocale === 'en' ? en : es }; }`,
  '@/lib/data': `export async function requireUser() { return { user: { id: 'self' }, db: globalThis.profileDb ?? {
    from() { return { select() { return this; }, eq() { return this; }, async single() { return { data: { avatar_path: null } }; } }; }
  } }; }`,
  'next/headers': `export async function cookies() { return { set() {} }; } export async function headers() { throw new Error('unexpected_headers'); }`,
  'next/cache': `export function revalidatePath() {}`,
  'next/navigation': `export function unstable_rethrow(e) { if (e?.redirect) throw e; } export function redirect(destination) { throw Object.assign(new Error('redirect'), { redirect: destination }); }`,
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
  const { authAction, profileAction, googleAction } = await import(
    pathToFileURL(path.join(temp, 'actions.mjs'))
  );
  for (const locale of ['es', 'en']) {
    globalThis.testLocale = locale;
    const mismatch = locale === 'es' ? 'Las contraseñas no coinciden.' : 'Passwords do not match.';
    const invalidImage =
      locale === 'es'
        ? 'Formato no soportado o archivo demasiado grande'
        : 'Unsupported format or file too large';
    for (const confirmation of ['', 'ABCD', ' abcd']) {
      const form = new FormData();
      form.set('password', 'abcd');
      form.set('password_confirmation', confirmation);
      assert.equal(
        (await authAction('register', {}, form)).fieldErrors?.password_confirmation,
        mismatch,
      );
    }
    let calls = [];
    globalThis.authDb = {
      auth: {
        async signUp() {
          calls.push('signUp');
          if (globalThis.signupError)
            return { data: null, error: { code: globalThis.signupError } };
          return { data: { session: globalThis.signupSession ?? null } };
        },
        async getUser() {
          return { data: { user: null } };
        },
        async updateUser() {
          calls.push('updateUser');
          return {};
        },
        async signOut(options) {
          calls.push(options);
          return {};
        },
        async signInWithPassword() {
          calls.push('login');
          return { error: { code: 'invalid_credentials' } };
        },
      },
    };
    const registration = () => {
      const form = new FormData();
      for (const [key, value] of Object.entries({
        name: 'Good name',
        email: 'valid@example.test',
        password: 'abcdef',
        password_confirmation: 'abcdef',
        next: '/join/abc',
      }))
        form.set(key, value);
      return form;
    };
    for (const kind of ['register', 'reset']) {
      for (const [password, confirmation, errorField] of [
        ['abcde', 'abcde', 'password'],
        ['abcdef', 'different', 'password_confirmation'],
        ['', '', 'password'],
        ['a'.repeat(129), 'a'.repeat(129), 'password'],
      ]) {
        const form = registration();
        form.set('password', password);
        form.set('password_confirmation', confirmation);
        assert.ok((await authAction(kind, {}, form)).fieldErrors?.[errorField]);
        assert.deepEqual(calls, []);
      }
    }
    for (const email of ['', 'bad-email']) {
      const form = registration();
      form.set('email', email);
      assert.ok((await authAction('register', {}, form)).fieldErrors?.email);
      assert.deepEqual(calls, []);
    }
    for (const next of ['/join/abc', 'https://external.test']) {
      const destinations = [];
      for (const code of [undefined, 'user_already_exists', 'email_exists']) {
        globalThis.signupError = code;
        const form = registration();
        form.set('next', next);
        await assert.rejects(authAction('register', {}, form), (e) => {
          destinations.push(e.redirect);
          const url = new URL(e.redirect, 'https://local.test');
          assert.equal(url.pathname, '/login');
          assert.equal(url.searchParams.get('registered'), '1');
          assert.equal(url.searchParams.get('next'), next.startsWith('/') ? next : '/homes');
          assert.deepEqual([...url.searchParams.keys()].sort(), ['next', 'registered']);
          return true;
        });
      }
      assert.deepEqual(destinations, [destinations[0], destinations[0], destinations[0]]);
    }
    globalThis.signupError = undefined;
    globalThis.signupSession = {};
    await assert.rejects(
      authAction('register', {}, registration()),
      (e) => e.redirect === '/join/abc',
    );
    globalThis.signupSession = null;
    process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED = 'false';
    const googleError =
      locale === 'es'
        ? 'No se pudo iniciar sesión con Google. Inténtalo de nuevo más tarde'
        : 'Could not sign in with Google. Try again later';
    assert.deepEqual(await googleAction({}, registration()), { error: googleError });
    process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED = 'true';
    const oldFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => {
        throw new Error('network');
      };
      assert.deepEqual(await googleAction({}, registration()), { error: googleError });
    } finally {
      globalThis.fetch = oldFetch;
    }
    calls = [];
    await assert.rejects(
      authAction('reset', {}, registration()),
      (e) => e.redirect === '/login?passwordChanged=1',
    );
    assert.deepEqual(calls, ['updateUser', { scope: 'local' }]);
    for (const email of ['known@example.test', 'unknown@example.test']) {
      const form = registration();
      form.set('email', email);
      form.set('password', 'x');
      assert.equal(
        (await authAction('login', {}, form)).error,
        locale === 'es' ? 'Credenciales incorrectas' : 'Incorrect credentials',
      );
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
    globalThis.profileDb = {
      from() {
        return {
          select() {
            return this;
          },
          update(value) {
            assert.equal(value.name, 'Good name');
            return this;
          },
          eq() {
            return this;
          },
          async single() {
            return { data: { avatar_path: null } };
          },
          then(resolve) {
            resolve({ error: null });
          },
        };
      },
    };
    const profile = registration();
    assert.equal(
      (await profileAction({}, profile)).success,
      locale === 'es' ? 'Perfil actualizado con éxito' : 'Profile updated successfully',
    );
    globalThis.profileDb = undefined;
  }
  console.log(
    'Server password confirmation, image size, MIME and signature regressions passed (es/en)',
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
