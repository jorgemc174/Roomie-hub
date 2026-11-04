import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';
import { createBrowserClient, createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClientOptions } from '@supabase/supabase-js';
import { recoveryTokens, recoveryDestination } from '../src/lib/auth-recovery';
import { authReturnUrl } from '../src/lib/auth-redirects';

test('recovery fragment accepts both tokens only for recovery', () => {
  assert.deepEqual(recoveryTokens('#access_token=access&refresh_token=refresh&type=recovery'), {
    access_token: 'access',
    refresh_token: 'refresh',
  });
  for (const fragment of [
    '',
    '#access_token=a&refresh_token=r&type=signup',
    '#access_token=a&refresh_token=r',
    '#access_token=a&type=recovery',
    '#refresh_token=r&type=recovery',
    '#access_token=&refresh_token=r&type=recovery',
    '#access_token=%20&refresh_token=r&type=recovery',
    '#error=access_denied&error_code=otp_expired&error_description=Expired',
    '#access_token=a&refresh_token=r&type=recovery&error=access_denied',
    '#access_token=a&refresh_token=r&type=recovery&error_code=otp_expired',
  ])
    assert.equal(recoveryTokens(fragment), null);
});

test('recovery destinations force password reset and preserve only safe retry destinations', () => {
  for (const next of [null, '/homes/join?code=abc', 'https://evil.test']) {
    assert.equal(recoveryDestination(true, next), '/reset-password');
    const failed = new URL(recoveryDestination(false, next), 'https://roomie.test');
    assert.equal(failed.pathname, '/login');
    assert.equal(failed.searchParams.get('error'), 'link');
    assert.equal(failed.searchParams.get('next'), next?.startsWith('/') ? next : '/homes');
  }
  const url = new URL(authReturnUrl('https://roomie.test', '/auth/recovery', '//evil.test'));
  assert.equal(url.pathname, '/auth/recovery');
  assert.equal(url.searchParams.get('next'), '/homes');
});

test('callback clears tokens before session creation, waits for cookies and handles failures', async () => {
  const source = await readFile('src/app/auth/recovery/recovery-session.tsx', 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  for (const scenario of ['success', 'error', 'throw', 'empty-session', 'invalid']) {
    const events: string[] = [];
    let effect: () => void = () => {};
    const exports: { RecoverySession?: (props: { loading: string }) => unknown } = {};
    const dependencies: Record<string, unknown> = {
      react: {
        useRef: () => ({ current: false }),
        useEffect: (fn: () => void) => {
          effect = fn;
        },
      },
      'react/jsx-runtime': jsxRuntime,
      '@/lib/supabase/config': { config: () => ({ url: 'https://auth.test', key: 'public-key' }) },
      '@/lib/auth-recovery': { recoveryTokens, recoveryDestination },
      '@supabase/ssr': {
        createBrowserClient: (_url: string, _key: string, options: object) => {
          assert.deepEqual(JSON.parse(JSON.stringify(options)), {
            isSingleton: false,
            auth: { detectSessionInUrl: false },
          });
          return {
            auth: {
              setSession: async (tokens: object) => {
                assert.deepEqual(tokens, { access_token: 'a', refresh_token: 'r' });
                assert.deepEqual(events, ['clear']);
                events.push('session');
                if (scenario === 'throw') throw new Error('provider failure');
                return {
                  data: { session: scenario === 'empty-session' ? null : {} },
                  error: scenario === 'error' ? {} : null,
                };
              },
            },
          };
        },
      },
    };
    vm.runInNewContext(outputText, {
      exports,
      URLSearchParams,
      require: (name: string) => {
        assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
        return dependencies[name];
      },
      window: {
        history: {
          replaceState: (_state: unknown, _title: string, url: string) => {
            assert.equal(url, '/auth/recovery?next=%2Fhomes');
            events.push('clear');
          },
        },
        location: {
          hash:
            scenario === 'invalid'
              ? '#error_code=otp_expired'
              : '#access_token=a&refresh_token=r&type=recovery',
          pathname: '/auth/recovery',
          search: '?next=%2Fhomes',
          replace: (url: string) => events.push(url),
        },
      },
    });
    exports.RecoverySession!({ loading: 'Loading' });
    effect();
    effect(); // Strict Mode must neither clear again nor install the session twice.
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(events, [
      'clear',
      ...(scenario === 'invalid' ? [] : ['session']),
      scenario === 'success' ? '/reset-password' : '/login?error=link&next=%2Fhomes',
    ]);
  }
});

test('SSR browser setSession writes cookies readable by the server without localStorage', async () => {
  const jar = new Map<string, string>();
  const cookies = {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (values: { name: string; value: string }[]) => {
      for (const { name, value } of values) jar.set(name, value);
    },
  };
  const user = { id: '00000000-0000-0000-0000-000000000001', aud: 'authenticated' };
  const access_token =
    [
      { alg: 'HS256', typ: 'JWT' },
      { sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 },
    ]
      .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
      .join('.') + '.c2lnbmF0dXJl';
  const options = {
    cookies,
    global: { fetch: async () => new Response(JSON.stringify(user), { status: 200 }) },
  };
  const browser = createBrowserClient('https://auth.test', 'public-key', {
    ...options,
    isSingleton: false,
    auth: { detectSessionInUrl: false, autoRefreshToken: false },
  });
  const { error } = await browser.auth.setSession({ access_token, refresh_token: 'test-refresh' });
  assert.equal(error, null);
  assert.ok([...jar.keys()].some((name) => name.startsWith('sb-') && name.includes('auth-token')));
  const server = createServerClient('https://auth.test', 'public-key', options);
  const { data } = await server.auth.getUser();
  assert.equal(data.user?.id, user.id);
});

test('recovery request uses the implicit SDK without a PKCE challenge or persisted session', async () => {
  const source = await readFile('src/lib/supabase/recovery.ts', 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  });
  let requests = 0;
  const exports: { recoveryClient?: () => ReturnType<typeof createClient> } = {};
  const dependencies: Record<string, unknown> = {
    'server-only': {},
    './config': { config: () => ({ url: 'https://auth.test', key: 'public-key' }) },
    '@supabase/supabase-js': {
      createClient: (url: string, key: string, options: SupabaseClientOptions<'public'>) => {
        assert.equal(options.auth?.flowType, 'implicit');
        assert.equal(options.auth?.persistSession, false);
        assert.equal(options.auth?.autoRefreshToken, false);
        return createClient(url, key, {
          ...options,
          global: {
            fetch: async (input, init) => {
              requests++;
              const request = new URL(String(input));
              assert.equal(request.pathname, '/auth/v1/recover');
              assert.equal(
                request.searchParams.get('redirect_to'),
                'https://roomie.test/auth/recovery?next=%2Fhomes',
              );
              const body = JSON.parse(String(init?.body));
              assert.equal(body.email, 'test@example.test');
              assert.equal(body.code_challenge ?? null, null);
              assert.equal(body.code_challenge_method ?? null, null);
              return new Response('{}', { status: 200 });
            },
          },
        });
      },
    },
  };
  vm.runInNewContext(outputText, {
    exports,
    require: (name: string) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  const { error } = await exports.recoveryClient!().auth.resetPasswordForEmail(
    'test@example.test',
    {
      redirectTo: authReturnUrl('https://roomie.test', '/auth/recovery', '/homes'),
    },
  );
  assert.equal(error, null);
  assert.equal(requests, 1);
});
