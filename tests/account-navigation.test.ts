import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountHref, accountReturnHref } from '../src/lib/account-navigation';

const home = '/homes/11111111-1111-4111-8111-111111111111';
test('account screens return to the originating workspace view, filters and anchor', () => {
  const source = `${home}/organization?view=all&from=2026-10-01#task-example`;
  for (const destination of ['/profile', '/notifications'] as const) {
    const href = accountHref(destination, source);
    assert.equal(new URL(href, 'https://test.invalid').searchParams.get('returnTo'), source);
    assert.equal(accountReturnHref(href), source);
  }
});

test('preferences return to profile or inbox while retaining the workspace context', () => {
  const workspace = `${home}/calendar?month=2026-10&day=2026-10-15&mine=1`;
  for (const destination of ['/profile', '/notifications'] as const) {
    const account = accountHref(destination, workspace);
    const preferences = accountHref('/notifications/preferences', account);
    assert.equal(accountReturnHref(preferences), account);
    assert.equal(accountReturnHref(accountReturnHref(preferences)!), workspace);
    assert.equal(accountReturnHref(accountHref('/profile', preferences)), workspace);
  }
});

test('direct entry has predictable fallback and repeated account navigation does not nest URLs', () => {
  assert.equal(accountReturnHref('/profile'), null);
  assert.equal(accountReturnHref('/notifications'), null);
  assert.equal(accountReturnHref('/notifications/preferences'), '/notifications');
  let current = accountHref('/profile', `${home}/expenses?tab=balances&page=2`);
  for (let i = 0; i < 30; i++) {
    current = accountHref('/notifications/preferences', current);
    current = accountHref('/profile', current);
  }
  assert.equal(accountReturnHref(current), `${home}/expenses?tab=balances&page=2`);
  assert.ok(current.length < 200);
});

test('return links reject external, ambiguous, encoded and non-screen destinations', () => {
  for (const target of [
    'https://outside.invalid',
    '//outside.invalid',
    '/\\outside.invalid',
    '/%2foutside.invalid',
    '/login',
    '/homes',
    '/homes/new',
    `${home}/expenses/receipt/123`,
    `${home}/chat/file/123`,
    `${home}/../new`,
    `${home}/chat\n`,
  ]) {
    assert.equal(
      accountReturnHref(`/profile?returnTo=${encodeURIComponent(target)}`),
      null,
      target,
    );
  }
  assert.equal(accountReturnHref(`/profile?returnTo=${home}&returnTo=${home}/chat`), null);
  assert.equal(
    accountHref('/profile', '/notifications?returnTo=https://outside.invalid'),
    '/profile',
  );
});
