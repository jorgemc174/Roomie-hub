import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authErrorMessage } from '../src/lib/auth-errors';
import { es, en } from '../src/lib/i18n/dictionaries';
test('registration errors distinguish rejection, rate limiting and connectivity in both locales', () => {
  for (const t of [es, en]) {
    assert.equal(authErrorMessage({ code: 'weak_password', status: 422 }, t), t.passwordRejected);
    assert.equal(
      authErrorMessage({ code: 'over_email_send_rate_limit', status: 429 }, t),
      t.authRateLimit,
    );
    assert.equal(
      authErrorMessage({ code: 'email_address_not_authorized' }, t),
      t.authEmailUnauthorized,
    );
    assert.equal(authErrorMessage({ code: 'email_address_invalid' }, t), t.authEmailInvalid);
    assert.equal(authErrorMessage({ code: 'email_address_not_allowed' }, t), t.authEmailRejected);
    assert.equal(authErrorMessage({ code: 'signup_disabled' }, t), t.authSignupDisabled);
    assert.equal(authErrorMessage({ code: 'email_not_confirmed' }, t), t.authEmailUnconfirmed);
    assert.equal(authErrorMessage({ code: 'invalid_credentials' }, t), t.authError);
    assert.equal(
      authErrorMessage({ name: 'AuthRetryableFetchError', status: 0 }, t),
      t.requestError,
    );
    assert.equal(
      authErrorMessage({ code: 'unexpected_failure', status: 500 }, t),
      t.authServiceError,
    );
  }
});
