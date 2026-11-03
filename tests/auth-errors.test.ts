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

test('PA literal account messages', () => {
  assert.equal(es.authError, 'Credenciales incorrectas');
  assert.equal(es.sessionError, 'El enlace ha expirado o no es válido');
  assert.equal(
    es.googleError,
    'No se pudo iniciar sesión con Google. Inténtalo de nuevo más tarde',
  );
  assert.equal(es.avatarImageError, 'Formato no soportado o archivo demasiado grande');
  assert.equal(es.profileUpdated, 'Perfil actualizado con éxito');
  assert.match(es.passwordHint, /6/);
});

test('registration acknowledgement never claims account creation', () => {
  assert.equal(
    es.registrationSent,
    'Registro recibido. Revisa tu correo para confirmar la cuenta. Si ya tenías cuenta, inicia sesión o recupera tu contraseña.',
  );
  assert.equal(
    en.registrationSent,
    'Registration received. Check your email to confirm your account. If you already had an account, sign in or recover your password.',
  );
});
