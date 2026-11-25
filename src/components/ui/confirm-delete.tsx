'use client';

import { useId, useRef, type ReactNode } from 'react';
import { ActionForm } from '@/components/action-form';
import type { ActionState } from '@/app/actions';

export function ConfirmDelete({
  action,
  label,
  prompt,
  confirmLabel,
  cancelLabel,
  pendingLabel,
  children,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  label: string;
  prompt: string;
  confirmLabel: string;
  cancelLabel: string;
  pendingLabel: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  return (
    <>
      <button
        type="button"
        ref={trigger}
        className="button secondary"
        onClick={() => {
          dialog.current?.showModal();
          cancel.current?.focus();
        }}
      >
        {label}
      </button>
      <dialog
        ref={dialog}
        className="confirm-delete-dialog"
        aria-labelledby={titleId}
        onKeyDown={(event) => event.stopPropagation()}
        onClose={() => trigger.current?.focus()}
      >
        <p id={titleId}>{prompt}</p>
        <ActionForm action={action} label={confirmLabel} pendingLabel={pendingLabel} danger>
          {children}
          <button
            ref={cancel}
            type="button"
            className="button secondary"
            onClick={() => dialog.current?.close()}
          >
            {cancelLabel}
          </button>
        </ActionForm>
      </dialog>
    </>
  );
}
