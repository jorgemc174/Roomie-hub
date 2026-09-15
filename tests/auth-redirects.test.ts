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
