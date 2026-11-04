import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { createElement, type ReactNode } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest, NextResponse } from 'next/server';
import { calendarMessages } from '../src/features/calendar/messages';
import { es, en } from '../src/lib/i18n/dictionaries';
import * as redirects from '../src/lib/auth-redirects';
import { safeNext } from '../src/lib/validation';

type State = { error?: string; success?: string };
async function isolated(path: string, dependencies: Record<string, unknown>, globals = {}) {
  const { outputText } = ts.transpileModule(await readFile(path, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const exports: Record<string, (...args: never[]) => unknown> = {};
  vm.runInNewContext(outputText, {
    exports,
    URL,
    URLSearchParams,
    ...globals,
    require: (name: string) => {
      if (name === 'react/jsx-runtime') return jsxRuntime;
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  return exports;
}

test('PA1269: each answer is a native submit, with saved selection, pending and retryable errors', async () => {
  for (const locale of ['es', 'en'] as const) {
    for (const pending of [false, true]) {
      const state: State = pending ? {} : { error: 'Save failed' };
      const loaded = await isolated('src/features/calendar/activity-response-form.tsx', {
        react: { useActionState: () => [state, '/server-action', pending] },
        '@/components/ui/form-feedback': {
          FormFeedback: ({ error }: State) =>
            error ? createElement('p', { role: 'alert' }, error) : null,
        },
        './actions': { calendarAction: () => {} },
        './messages': { calendarMessages },
      });
      const render = loaded.ActivityResponseForm as (props: object) => ReactNode;
      const html = renderToStaticMarkup(
        render({ homeId: 'home', id: 'plan', locale, response: 'maybe' }),
      );
      assert.match(html, /<form[^>]+action="\/server-action"/);
      assert.match(html, /name="id" value="plan"/);
      assert.equal((html.match(/<button[^>]*name="response"/g) ?? []).length, 3);
      for (const answer of ['going', 'maybe', 'not_going'])
        assert.ok(html.includes(`value="${answer}"`));
      assert.match(html, /value="maybe"[^>]+aria-pressed="true"/);
      assert.ok(!html.includes(calendarMessages(locale).saveResponse));
      if (pending) {
        assert.match(html, /<fieldset disabled="">/);
        assert.ok(html.includes(`<p role="status">${calendarMessages(locale).saving}</p>`));
      } else {
        assert.ok(!html.includes('disabled=""'));
        assert.match(html, /role="alert">Save failed/);
      }
    }
  }
});

test('PA1269: native answer payload calls the canonical RPC once and revalidates groups; errors stay visible', async () => {
  const calls: unknown[] = [],
    refreshed: unknown[] = [];
  let fail = false;
  const loaded = await isolated('src/features/calendar/actions.ts', {
    'next/cache': { revalidatePath: (...args: unknown[]) => refreshed.push(args) },
    'next/navigation': { unstable_rethrow: () => {} },
    '@/lib/data': {
      getHome: async () => ({ timezone: 'UTC' }),
      requireUser: async () => ({
        db: {
          rpc: async (...args: unknown[]) => {
            calls.push(args);
            return { error: fail ? { message: 'network' } : null };
          },
        },
      }),
    },
    '@/lib/i18n/server': { i18n: async () => ({ locale: 'es' }) },
    './messages': { calendarMessages },
    './logic': {},
  });
  const action = loaded.calendarAction as (
    home: string,
    op: string,
    state: State,
    form: FormData,
  ) => Promise<State>;
  const form = new FormData();
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  form.set('id', id);
  form.set('version', '0');
  for (const answer of ['going', 'maybe', 'not_going']) {
    form.set('response', answer);
    assert.equal((await action('home', 'attend', {}, form)).success, calendarMessages('es').saved);
    assert.equal(
      JSON.stringify(calls.at(-1)),
      JSON.stringify(['respond_activity', { target: 'home', item: id, answer }]),
    );
  }
  assert.equal(calls.length, 3);
  assert.equal(refreshed.length, 3);
  assert.equal(JSON.stringify(refreshed[0]), JSON.stringify(['/homes/home', 'layout']));
  fail = true;
  assert.equal((await action('home', 'attend', {}, form)).error, calendarMessages('es').error);
  assert.equal(refreshed.length, 3);
});

test('PA1157: provider errors, missing code/state, exchange rejection and network throw return safe login', async () => {
  for (const scenario of ['provider', 'missing', 'state', 'exchange', 'network']) {
    let exchanges = 0;
    const loaded = await isolated('src/app/auth/callback/route.ts', {
      'next/server': { NextResponse },
      '@supabase/ssr': {
        createServerClient: () => ({
          auth: {
            exchangeCodeForSession: async () => {
              exchanges++;
              if (scenario === 'network') throw new TypeError('private provider details');
              return { data: { user: null }, error: { code: 'bad_code_verifier' } };
            },
          },
        }),
      },
      '@/lib/supabase/config': {
        config: () => ({ url: 'https://auth.test', key: 'public-test-key' }),
      },
      '@/lib/auth-redirects': { ...redirects, siteOrigin: () => 'https://roomie.test' },
      '@/lib/google-profile': { importGoogleAvatar: () => assert.fail('must not import') },
    });
    const query = new URLSearchParams({ next: '/homes/join?code=invitation' });
    if (scenario === 'provider') query.set('error', 'server_error');
    if (scenario === 'state') query.set('error', 'invalid_state');
    if (scenario === 'exchange' || scenario === 'network') query.set('code', 'invalid-code');
    const get = loaded.GET as (request: NextRequest) => Promise<NextResponse>;
    const response = await get(new NextRequest(`https://untrusted.test/auth/callback?${query}`));
    const target = new URL(response.headers.get('location')!);
    assert.equal(target.origin, 'https://roomie.test');
    assert.equal(target.pathname, '/login');
    assert.equal(target.searchParams.get('error'), 'google');
    assert.equal(target.searchParams.get('next'), '/homes/join?code=invitation');
    assert.match(response.headers.get('cache-control')!, /no-store/);
    assert.equal(response.headers.has('set-cookie'), false);
    assert.equal(exchanges, ['exchange', 'network'].includes(scenario) ? 1 : 0);
  }
});

test('PA1157: OAuth initiation failures retain the literal message before leaving the app', async () => {
  for (const t of [es, en]) {
    for (const scenario of [
      'disabled',
      'settings-disabled',
      'settings-http',
      'settings-network',
      'oauth-error',
      'oauth-throw',
      'no-url',
    ]) {
      let oauthCalls = 0;
      const loaded = await isolated(
        'src/app/actions.ts',
        {
          '@/features/expenses/messages': {},
          'next/headers': {},
          'next/cache': {},
          'next/navigation': {
            unstable_rethrow: () => {},
            redirect: () => assert.fail('must stay in app'),
          },
          '@/lib/supabase/server': {
            supabase: async () => ({
              auth: {
                signInWithOAuth: async () => {
                  oauthCalls++;
                  if (scenario === 'oauth-throw') throw new TypeError('private provider details');
                  return {
                    data: { url: null },
                    error: scenario === 'oauth-error' ? { message: 'private' } : null,
                  };
                },
              },
            }),
          },
          '@/lib/supabase/config': {
            config: () => ({ url: 'https://auth.test', key: 'public-test-key' }),
          },
          '@/lib/data': {},
          '@/lib/i18n/server': { i18n: async () => ({ t }) },
          '@/lib/validation': { safeNext },
          '@/lib/profile-validation': {},
          '@/lib/currencies': {},
          '@/lib/timezones': {},
          '@/lib/auth-errors': {},
          '@/lib/auth-redirects': { ...redirects, siteOrigin: () => 'https://roomie.test' },
        },
        {
          process: {
            env: { NEXT_PUBLIC_GOOGLE_AUTH_ENABLED: scenario === 'disabled' ? 'false' : 'true' },
          },
          AbortSignal,
          fetch: async () => {
            if (scenario === 'settings-network') throw new TypeError('offline');
            return {
              ok: scenario !== 'settings-http',
              json: async () => ({ external: { google: scenario !== 'settings-disabled' } }),
            };
          },
        },
      );
      const action = loaded.googleAction as (state: State, form: FormData) => Promise<State>;
      assert.equal((await action({}, new FormData())).error, t.googleError);
      assert.equal(oauthCalls, scenario.startsWith('oauth-') || scenario === 'no-url' ? 1 : 0);
    }
  }
});
