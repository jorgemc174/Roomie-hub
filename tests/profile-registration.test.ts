import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authErrorMessage } from '../src/lib/auth-errors';
import { es, en } from '../src/lib/i18n/dictionaries';
import {
  avatarInitials,
  validAvatarFile,
  matchingPasswords,
  AVATAR_MAX_BYTES,
} from '../src/lib/profile-validation';

test('registration requires an exact, nonempty password confirmation', () => {
  assert.equal(matchingPasswords('abcd', 'abcd'), true);
  for (const confirmation of ['', 'abcD', ' abcd', 'abcd '])
    assert.equal(matchingPasswords('abcd', confirmation), false);
  assert.equal(matchingPasswords('', ''), false);
});
test('avatar accepts only JPG, PNG and WebP within a safe multipart budget', () => {
  assert.equal(AVATAR_MAX_BYTES, 4_000_000);
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
    assert.equal(validAvatarFile({ type, size: AVATAR_MAX_BYTES }), true);
    assert.equal(validAvatarFile({ type, size: AVATAR_MAX_BYTES + 1 }), false);
  }
  for (const type of ['image/svg+xml', 'application/pdf', ''])
    assert.equal(validAvatarFile({ type, size: 100 }), false);
});
test('avatar initials handle whitespace, accents and compound names', () => {
  assert.equal(avatarInitials('  María   del Mar  '), 'MM');
  assert.equal(avatarInitials('Jorge'), 'J');
  assert.equal(avatarInitials(''), '');
});

test('auth errors never disclose whether an email is already registered', () => {
  for (const t of [es, en])
    for (const code of ['invalid_credentials', 'user_already_exists', 'email_exists'])
      assert.equal(authErrorMessage({ code }, t), t.authError);
});
