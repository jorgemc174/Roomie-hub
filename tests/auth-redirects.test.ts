import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeNext } from '../src/lib/validation';
import { authReturnUrl, authDestination, authFailurePath } from '../src/lib/auth-redirects';
test('unsafe literal, encoded and normalized auth destinations are rejected', () => {
  for (const next of [
    'https://evil.test',
    '//evil.test',
    '/\\evil.test',
    '/%5cevil.test',
    '/%2fevil.test',
    '/%252fevil.test',
    '/foo/..//evil.test',
    '/\tevil.test',
    '/homes%0d%0aLocation:evil',
    'javascript:alert(1)',
    '/%ZZ',
  ]) {
    assert.equal(safeNext(next), '/homes', next);
    assert.equal(authDestination(next), '/homes', next);
    assert.equal(
      new URL(authReturnUrl('https://roomie.test', '/auth/callback', next)).searchParams.get(
        'next',
      ),
      '/homes',
    );
  }
});
test('email confirmation and OAuth round-trip each invitation independently', () => {
  for (const code of ['a'.repeat(32), 'b'.repeat(32)]) {
    const next = `/homes/join?code=${code}`;
    for (const path of ['/auth/confirm', '/auth/callback'] as const) {
      const providerReturn = new URL(authReturnUrl('https://roomie.test', path, next));
      // Same shape as the configured email template or OAuth return, without cookies.
      if (path === '/auth/confirm') {
        providerReturn.searchParams.set('token_hash', 'test-token');
        providerReturn.searchParams.set('type', 'email');
      } else providerReturn.searchParams.set('code', 'test-oauth-code');
      assert.equal(providerReturn.origin, 'https://roomie.test');
      assert.equal(
        authDestination(
          providerReturn.searchParams.get('next'),
          providerReturn.searchParams.get('type'),
        ),
        next,
      );
      assert.equal(authDestination(next, 'signup'), next);
      const retry = new URL(authFailurePath(next), 'https://roomie.test');
      assert.equal(retry.pathname, '/login');
      assert.equal(retry.searchParams.get('next'), next);
    }
  }
});
test('recovery cannot skip changing the password; legacy links default to homes', () => {
  assert.equal(authDestination('/homes/join?code=abc', 'recovery'), '/reset-password');
  assert.equal(authDestination(null, 'email'), '/homes');
  assert.equal(authDestination(null), '/homes');
});

test('Google cancellation is informational, preserves safe next and rejects external next', async () => {
  const { googleCallbackFailurePath } = await import('../src/lib/auth-redirects');
  for (const next of ['/homes/join?code=abc', 'https://evil.test']) {
    const url = new URL(
      googleCallbackFailurePath(next, 'access_denied', true),
      'https://roomie.test',
    );
    assert.equal(url.searchParams.get('notice'), 'googleCancelled');
    assert.equal(url.searchParams.has('error'), false);
    assert.equal(url.searchParams.get('next'), safeNext(next));
  }
  assert.match(googleCallbackFailurePath(null, 'server_error', true), /error=google/);
});

test('callback cancellation returns immediately without session cookies even when code is present', async () => {
  const { NextRequest } = await import('next/server');
  const { GET } = await import('../src/app/auth/callback/route');
  const previous = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = 'https://roomie.test';
  try {
    for (const next of ['/homes/join?code=abc', '//evil.test']) {
      const response = await GET(
        new NextRequest(
          `https://roomie.test/auth/callback?${new URLSearchParams({
            error: 'access_denied',
            code: 'must-not-exchange',
            next,
          })}`,
        ),
      );
      assert.equal(response.status, 307);
      const target = new URL(response.headers.get('location')!);
      assert.equal(target.searchParams.get('notice'), 'googleCancelled');
      assert.equal(target.searchParams.get('next'), safeNext(next));
      assert.equal(response.headers.has('set-cookie'), false);
    }
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = previous;
  }
});

test('cancellation copy is informational in both dictionaries and auth screen', async () => {
  const { es, en } = await import('../src/lib/i18n/dictionaries');
  assert.equal(es.googleCancelled, 'Autenticación cancelada');
  assert.equal(en.googleCancelled, 'Authentication cancelled');
  const { readFile } = await import('node:fs/promises');
  const screen = await readFile('src/components/auth-screen.tsx', 'utf8');
  assert.match(screen, /notice === 'googleCancelled'[\s\S]*?className="notice" role="status"/);
});
