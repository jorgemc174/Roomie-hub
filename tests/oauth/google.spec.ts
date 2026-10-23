import { test, expect, type Page } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const app = 'http://127.0.0.1:3200';
const provider = 'http://127.0.0.1:54331';
const code = 'a'.repeat(32);
const destination = `/homes/join?code=${code}`;
const message =
  'No se ha podido iniciar sesión con Google. Vuelve a intentarlo o accede con tu correo.';
const alert = (page: Page) => page.getByRole('main').getByRole('alert');

test.beforeAll(async ({ request }) => {
  await expect
    .poll(
      async () => {
        try {
          return (await request.get(app + '/login')).status();
        } catch {
          return 0;
        }
      },
      { timeout: 15000 },
    )
    .toBe(200);
});
test.beforeEach(async ({ request }) => {
  expect((await request.post(provider + '/__test/reset', { data: {} })).ok()).toBe(true);
});

async function begin(page: Page, next = destination, path = '/login') {
  await page.goto(`${app}${path}?next=${encodeURIComponent(next)}`);
  await page.getByRole('button', { name: 'Continuar con Google' }).click();
  await expect(page.getByRole('heading', { name: 'Local OAuth fixture' })).toBeVisible();
  const authorize = new URL(page.url());
  expect(authorize.pathname).toBe('/auth/v1/authorize');
  expect(authorize.searchParams.get('provider')).toBe('google');
  expect(authorize.searchParams.get('code_challenge_method')).toBe('s256');
  expect(authorize.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const callback = new URL(authorize.searchParams.get('redirect_to')!);
  expect(callback.origin).toBe(app);
  expect(callback.pathname).toBe('/auth/callback');
  expect(callback.searchParams.get('next')).toBe(next);
}

test('real SDK creates S256 verifier cookies, exchanges once and returns to explicit Join', async ({
  page,
  context,
  request,
}) => {
  await begin(page);
  const cookies = await context.cookies(app);
  const verifier = cookies.find((cookie) => /auth-token-code-verifier$/.test(cookie.name));
  expect(verifier).toBeDefined();
  expect(verifier?.sameSite).toBe('Lax');
  expect(verifier?.path).toBe('/');
  const callbackPromise = page.waitForResponse((response) =>
    response.url().startsWith(app + '/auth/callback?'),
  );
  await page.getByRole('link', { name: 'Allow fixture' }).click();
  const callback = await callbackPromise;
  const callbackHeaders = await callback.allHeaders();
  expect(callback.status()).toBe(307);
  expect(callbackHeaders['cache-control']).toContain('no-store');
  expect(callbackHeaders['pragma']).toBe('no-cache');
  expect(callbackHeaders['expires']).toBe('0');
  expect(callbackHeaders['referrer-policy']).toBe('no-referrer');
  expect(callbackHeaders['location']).toBe(app + destination);
  await expect(page).toHaveURL(app + destination);
  // The PWA worker filters Set-Cookie from its fetch response. Check that the
  // browser actually received the session instead of relying on that header.
  expect(
    (await context.cookies(app)).some((cookie) => /auth-token(?:\.\d+)?$/.test(cookie.name)),
  ).toBe(true);
  await expect(page.getByRole('heading', { name: 'Unirme a un piso' })).toBeVisible();
  await expect(page.getByLabel('Código de invitación')).toHaveValue(code);
  await expect(page.getByRole('button', { name: 'Unirme', exact: true })).toBeEnabled();
  const state = await (await request.get(provider + '/__test/state')).json();
  expect(state).toMatchObject({ authorizations: 1, exchanges: 1, matched: 1, joins: 0 });
  expect((await context.cookies(app)).some((cookie) => cookie.name === verifier?.name)).toBe(false);
  // Replaying the callback cannot exchange or join again after the verifier was consumed.
  const replay = await context.request.get(callback.url(), { maxRedirects: 0 });
  expect(new URL(replay.headers().location).searchParams.get('error')).toBe('google');
  expect(new URL(replay.headers().location).searchParams.get('next')).toBe(destination);
  expect((await (await request.get(provider + '/__test/state')).json()).exchanges).toBe(1);
});

test('registration uses the same OAuth flow without requiring the password form', async ({
  page,
}) => {
  await begin(page, destination, '/register');
  await page.getByRole('link', { name: 'Allow fixture' }).click();
  await expect(page).toHaveURL(app + destination);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Unirme a un piso' })).toBeVisible();
});

test('proxy refreshes an expired session once and returns private headers and fresh cookies', async ({
  page,
  context,
  request,
  playwright,
}) => {
  await begin(page);
  await page.getByRole('link', { name: 'Allow fixture' }).click();
  await expect(page).toHaveURL(app + destination);
  const cookie = (await context.cookies(app)).find((item) => /auth-token$/.test(item.name));
  expect(cookie?.value.startsWith('base64-')).toBe(true);
  const stored = JSON.parse(Buffer.from(cookie!.value.slice(7), 'base64url').toString());
  stored.expires_at = Math.floor(Date.now() / 1000) - 60;
  // An independent jar avoids racing browser prefetches against the deliberately
  // expired cookie. The request still runs proxy -> protected server components.
  const client = await playwright.request.newContext({
    storageState: {
      cookies: [
        {
          ...cookie!,
          value: 'base64-' + Buffer.from(JSON.stringify(stored)).toString('base64url'),
        },
      ],
      origins: [],
    },
  });
  try {
    const response = await client.get(app + destination);
    expect(response.url()).toBe(app + destination);
    const headers = response.headers();
    expect(headers['cache-control']).toContain('no-store');
    expect(headers['pragma']).toBe('no-cache');
    expect(headers['expires']).toBe('0');
    expect(headers['set-cookie']).toContain('auth-token');
    expect((await (await request.get(provider + '/__test/state')).json()).refreshes).toBe(1);
    expect((await client.get(app + destination)).url()).toBe(app + destination);
    expect((await (await request.get(provider + '/__test/state')).json()).refreshes).toBe(1);
  } finally {
    await client.dispose();
  }
});

test('disabled provider shows one error and preserves email login and invitation', async ({
  page,
  request,
}) => {
  await request.post(provider + '/__test/reset', { data: { google: false } });
  await page.goto(`${app}/login?next=${encodeURIComponent(destination)}`);
  await page.getByRole('button', { name: 'Continuar con Google' }).click();
  await expect(alert(page)).toHaveText(message);
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeEnabled();
  await expect(page.locator('input[name=next]').first()).toHaveValue(destination);
  expect((await (await request.get(provider + '/__test/state')).json()).authorizations).toBe(0);
});

test('pending disables repeat submission, then errors allow retry with no stale notice', async ({
  page,
  request,
}) => {
  await request.post(provider + '/__test/reset', { data: { google: false, delay: 1000 } });
  await page.goto(`${app}/login?error=google&next=${encodeURIComponent(destination)}`);
  const form = page.locator('form.form').filter({ has: page.locator('button.secondary') });
  await form.getByRole('button').click();
  await expect(form.getByRole('button')).toBeDisabled();
  await expect(form.getByRole('button')).toHaveText('Un momento…');
  await expect(form).toHaveAttribute('aria-busy', 'true');
  await expect(alert(page)).toHaveCount(0);
  await expect(alert(page)).toHaveText(message);
  await expect(form.getByRole('button')).toBeEnabled();
  await expect(form.locator('input[name=next]')).toHaveValue(destination);
  await request.post(provider + '/__test/reset', { data: {} });
  await page.getByRole('button', { name: 'Continuar con Google' }).click();
  await expect(page.getByRole('heading', { name: 'Local OAuth fixture' })).toBeVisible();
});

for (const [name, setting] of [
  ['HTTP error', { status: 503 }],
  ['malformed settings', { malformed: true }],
  ['settings timeout', { delay: 5500 }],
] as const) {
  test(`${name} stays inside the app without leaking provider details`, async ({
    page,
    request,
  }) => {
    await request.post(provider + '/__test/reset', { data: setting });
    await page.goto(`${app}/login?next=${encodeURIComponent(destination)}`);
    await page.getByRole('button', { name: 'Continuar con Google' }).click();
    await expect(alert(page)).toHaveText(message, { timeout: 10000 });
    await expect(page).toHaveURL(`${app}/login?next=${encodeURIComponent(destination)}`);
    await expect(page.getByRole('button', { name: 'Continuar con Google' })).toBeEnabled();
  });
}

test('cancelled consent and failed exchange retain only safe retry information', async ({
  page,
  request,
}) => {
  await begin(page);
  await page.getByRole('link', { name: 'Cancel fixture' }).click();
  await expect(alert(page)).toHaveText(message);
  expect(new URL(page.url()).searchParams.get('next')).toBe(destination);
  expect(page.url()).not.toContain('private-provider-details');
  expect(await page.content()).not.toContain('private-provider-details');
  expect((await (await request.get(provider + '/__test/state')).json()).exchanges).toBe(0);
  await request.post(provider + '/__test/reset', { data: { tokenError: true } });
  await begin(page);
  await page.getByRole('link', { name: 'Allow fixture' }).click();
  await expect(alert(page)).toHaveText(message);
  expect(new URL(page.url()).searchParams.get('next')).toBe(destination);
  expect(await page.content()).not.toContain('private-provider-details');
  expect((await (await request.get(provider + '/__test/state')).json()).matched).toBe(1);
});

test('callback rejects missing verifiers, invalid flow identifiers and spoofed redirect hosts', async ({
  request,
  page,
}) => {
  const queries: Record<string, string>[] = [
    { next: destination },
    { next: destination, code: 'unissued-code' },
    { next: destination, code: 'unissued-code', error: 'access_denied' },
    { next: '//evil.test', code: 'unissued-code' },
    { next: '/%255cevil.test', error: 'private-provider-details' },
  ];
  for (const query of queries) {
    const response = await request.get(app + '/auth/callback?' + new URLSearchParams(query), {
      maxRedirects: 0,
      headers: { 'X-Forwarded-Host': 'evil.test' },
    });
    expect(response.status()).toBe(307);
    const redirect = new URL(response.headers().location);
    expect(redirect.origin).toBe(app);
    expect(redirect.pathname).toBe('/login');
    expect(redirect.searchParams.get('next')).toBe(
      query.next === destination ? destination : '/homes',
    );
    expect(response.headers()['cache-control']).toContain('no-store');
  }
  await begin(page);
  // Even with a legacy verifier present, an invalid explicit flow id must fail closed.
  await page.goto(
    app +
      '/auth/callback?' +
      new URLSearchParams({ next: destination, code: 'unissued-code', sb_flow_id: 'invalid' }),
  );
  await expect(alert(page)).toHaveText(message);
  expect((await (await request.get(provider + '/__test/state')).json()).exchanges).toBe(0);
});

test('unsafe next is sanitized before starting OAuth', async ({ page, request }) => {
  await page.goto(`${app}/login?next=${encodeURIComponent('/%5cevil.test')}`);
  await page.getByRole('button', { name: 'Continuar con Google' }).click();
  await expect(page.getByRole('heading', { name: 'Local OAuth fixture' })).toBeVisible();
  const callback = new URL(new URL(page.url()).searchParams.get('redirect_to')!);
  expect(callback.searchParams.get('next')).toBe('/homes');
  expect((await (await request.get(provider + '/__test/state')).json()).joins).toBe(0);
});

test('infrastructure secrets are absent from production HTML, action responses and all browser bundles', async ({
  page,
  request,
}) => {
  const sentinel = process.env.AUTH_TEST_SENTINEL;
  expect(sentinel).toBeTruthy();
  const outgoing: string[] = [];
  page.on('request', (request) => {
    outgoing.push(JSON.stringify(request.headers()), request.postData() ?? '');
  });
  page.on('response', (response) => {
    if (response.url().startsWith(app)) {
      outgoing.push(JSON.stringify(response.headers()));
    }
  });
  await request.post(provider + '/__test/reset', { data: { google: false } });
  const html = await page.goto(app + '/login');
  expect(await html!.text()).not.toContain(sentinel!);
  const actionResponse = page.waitForResponse(
    (response) => response.url().startsWith(app) && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Continuar con Google' }).click();
  await expect(alert(page)).toHaveText(message);
  const action = await actionResponse;
  expect(await action.text()).not.toContain(sentinel!);
  expect((await action.allHeaders())['cache-control']).toContain('no-store');
  await request.post(provider + '/__test/reset', { data: {} });
  await begin(page);
  await page.getByRole('link', { name: 'Cancel fixture' }).click();
  await expect(alert(page)).toHaveText(message);
  expect(await page.content()).not.toContain(sentinel!);
  await begin(page);
  await page.getByRole('link', { name: 'Allow fixture' }).click();
  await expect(page).toHaveURL(app + destination);
  expect(await page.content()).not.toContain(sentinel!);
  outgoing.push(JSON.stringify(await page.context().cookies()));
  for (const text of outgoing) expect(text.includes(sentinel!)).toBe(false);
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (/\.(js|json|map)$/.test(entry.name)) {
        const text = await readFile(path, 'utf8');
        expect(text.includes(sentinel!)).toBe(false);
      }
    }
  };
  await visit('.next/static');
});
