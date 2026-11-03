'use client';
import { useContext, useId, useRef, useState } from 'react';
import { ActionFormState } from './action-form';
import { PasswordField } from './password-field';
import { matchingPasswords } from '@/lib/profile-validation';
import type { Messages } from '@/lib/i18n/dictionaries';

export function RegisterPasswords({ t, reset = false }: { t: Messages; reset?: boolean }) {
  const confirmation = useRef<HTMLInputElement>(null);
  const id = useId();
  const state = useContext(ActionFormState);
  const [local, setLocal] = useState<{ state: typeof state; message: string }>();
  const message = local?.state === state ? local.message : state.fieldErrors?.password_confirmation;
  function validate() {
    const input = confirmation.current;
    if (!input) return;
    const password = input.form?.elements.namedItem('password');
    const mismatch =
      input.value.length > 0 &&
      password instanceof HTMLInputElement &&
      !matchingPasswords(password.value, input.value);
    input.setCustomValidity(mismatch ? t.passwordMismatch : '');
    setLocal({ state, message: mismatch ? t.passwordMismatch : '' });
  }
  return (
    <div onInput={validate}>
      <PasswordField
        label={reset ? t.newPassword : t.password}
        showLabel={t.showPassword}
        hideLabel={t.hidePassword}
        autoComplete="new-password"
        minLength={6}
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
        minLength={6}
        maxLength={128}
        onInvalid={(event) => {
          const validity = event.currentTarget.validity;
          setLocal({
            state,
            message: validity.customError
              ? t.passwordMismatch
              : validity.valueMissing
                ? t.invalid
                : t.passwordHint,
          });
        }}
        aria-invalid={!!message}
        aria-describedby={message ? `${id}-error` : undefined}
      />
      {message && (
        <small id={`${id}-error`} role="alert">
          {message}
        </small>
      )}
    </div>
  );
}
