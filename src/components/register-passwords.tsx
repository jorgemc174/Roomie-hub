'use client';
import { useId, useRef, useState } from 'react';
import { PasswordField } from './password-field';
import { matchingPasswords } from '@/lib/profile-validation';
import type { Messages } from '@/lib/i18n/dictionaries';

export function RegisterPasswords({ t }: { t: Messages }) {
  const confirmation = useRef<HTMLInputElement>(null);
  const [error, setError] = useState(false);
  const id = useId();
  function validate() {
    const input = confirmation.current;
    if (!input) return;
    const password = input.form?.elements.namedItem('password');
    const mismatch =
      input.value.length > 0 &&
      password instanceof HTMLInputElement &&
      !matchingPasswords(password.value, input.value);
    input.setCustomValidity(mismatch ? t.passwordMismatch : '');
    setError(mismatch);
  }
  return (
    <div onInput={validate}>
      <PasswordField
        label={t.password}
        showLabel={t.showPassword}
        hideLabel={t.hidePassword}
        autoComplete="new-password"
        minLength={4}
        hint={t.passwordHint}
      />
      <label htmlFor={id}>{t.repeatPassword}</label>
      <input
        id={id}
        ref={confirmation}
        name="password_confirmation"
        type="password"
        autoComplete="new-password"
        required
        minLength={4}
        maxLength={128}
        aria-invalid={error}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && (
        <small id={`${id}-error`} role="alert">
          {t.passwordMismatch}
        </small>
      )}
    </div>
  );
}
