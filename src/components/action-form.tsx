'use client';
import { useActionState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import type { ActionState } from '@/app/actions';
function Fields({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();
  return <fieldset disabled={pending}>{children}</fieldset>;
}
function Submit({
  label,
  pendingLabel,
  danger,
  secondary,
}: {
  label: string;
  pendingLabel: string;
  danger?: boolean;
  secondary?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className={danger ? 'button danger' : secondary ? 'button secondary' : 'button'}
      type="submit"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
export function ActionForm({
  action,
  children,
  label,
  pendingLabel,
  danger,
  secondary,
  initialError,
  className = 'form',
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  children?: ReactNode;
  label: string;
  pendingLabel: string;
  danger?: boolean;
  secondary?: boolean;
  initialError?: string;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: initialError });
  return (
    <form action={formAction} className={className} aria-busy={pending}>
      <Fields>{children}</Fields>
      {!pending && state.error && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
      {!pending && state.success && (
        <p className="notice success" role="status">
          {state.success}
        </p>
      )}
      <Submit label={label} pendingLabel={pendingLabel} danger={danger} secondary={secondary} />
    </form>
  );
}
