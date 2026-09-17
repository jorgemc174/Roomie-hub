'use client';
import { useActionState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import type { ActionState } from '@/app/actions';
function Fields({children}:{children:ReactNode}) {
  const {pending}=useFormStatus();
  return <fieldset disabled={pending}>{children}</fieldset>;
}
function Submit({
  label,
  pendingLabel,
  danger,
}: {
  label: string;
  pendingLabel: string;
  danger?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className={danger ? 'button danger' : 'button'} type="submit">
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
  className = 'form',
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  children?: ReactNode;
  label: string;
  pendingLabel: string;
  danger?: boolean;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className={className}>
      <Fields>{children}</Fields>
      {state.error && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="notice success" role="status">
          {state.success}
        </p>
      )}
      <Submit label={label} pendingLabel={pendingLabel} danger={danger} />
    </form>
  );
}
