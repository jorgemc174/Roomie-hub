'use client';
import { useContext, useId, useState, type ComponentProps } from 'react';
import { ActionFormState } from './action-form';

/** Native validation and server validation expose the same field-level feedback. */
export function AuthInput({
  invalidMessage,
  ...props
}: ComponentProps<'input'> & { invalidMessage: string }) {
  const generatedId = useId();
  const id = props.id ?? generatedId;
  const state = useContext(ActionFormState);
  const [local, setLocal] = useState<{ state: typeof state; error: string }>();
  const error = local?.state === state ? local.error : state.fieldErrors?.[props.name ?? ''];
  return (
    <>
      <input
        {...props}
        id={id}
        aria-invalid={!!error || props['aria-invalid']}
        aria-describedby={
          [props['aria-describedby'], error ? `${id}-error` : ''].filter(Boolean).join(' ') ||
          undefined
        }
        onInvalid={(event) => {
          setLocal({ state, error: invalidMessage });
          props.onInvalid?.(event);
        }}
        onInput={(event) => {
          setLocal({ state, error: event.currentTarget.validity.valid ? '' : invalidMessage });
          props.onInput?.(event);
        }}
      />
      {error && (
        <small id={`${id}-error`} role="alert">
          {error}
        </small>
      )}
    </>
  );
}
