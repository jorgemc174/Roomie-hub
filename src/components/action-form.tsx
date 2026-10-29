'use client';
import { useRetainedForm } from '@/components/ui/use-retained-form';
import { useActionState, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { FormFeedback } from './ui/form-feedback';
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
      {pending && <LoaderCircle className="ui-spinner" size={18} aria-hidden="true" />}
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
  const retainForm = useRetainedForm(state.error, pending);
  return (
    <form onSubmit={retainForm} action={formAction} className={className} aria-busy={pending}>
      <Fields>{children}</Fields>
      <FormFeedback error={state.error} success={state.success} pending={pending} />
      <Submit label={label} pendingLabel={pendingLabel} danger={danger} secondary={secondary} />
    </form>
  );
}
