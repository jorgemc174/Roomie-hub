'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ActionForm } from '@/components/action-form';
import type { ActionState } from '@/app/actions';
import type { OrganizationMessages } from './messages';

export function ShoppingAnchor({ createdId }: { createdId: string }) {
  useEffect(() => {
    if (!createdId) return;
    const target = document.getElementById(`shopping-${createdId}`);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'start' });
  }, [createdId]);
  return null;
}

export function DeleteShoppingList({
  listId,
  action,
  t,
}: {
  listId: string;
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  t: OrganizationMessages;
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
        {t.listDelete}
      </button>
      <dialog
        ref={dialog}
        className="shopping-delete-dialog"
        aria-labelledby={titleId}
        onKeyDown={(event) => event.stopPropagation()}
        onClose={() => trigger.current?.focus()}
      >
        <p id={titleId}>{t.deleteListPrompt}</p>
        <ActionForm action={action} label={t.confirmDelete} pendingLabel={t.saving} danger>
          <input type="hidden" name="list_id" value={listId} />
          <button
            ref={cancel}
            type="button"
            className="button secondary"
            onClick={() => dialog.current?.close()}
          >
            {t.cancel}
          </button>
        </ActionForm>
      </dialog>
    </>
  );
}

// Keep ActionForm's pending/error handling and retained drafts in both modes.
export function ShoppingListNameForm({
  action,
  t,
  list,
  itemListId,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  t: OrganizationMessages;
  list?: { id: string; name: string };
  itemListId?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const details = useRef<HTMLDetailsElement>(null);
  const [invalid, setInvalid] = useState(false);
  const [restored, setRestored] = useState(false);
  const errorId = useId();

  function submit(event: FormEvent<HTMLDivElement>) {
    const name = input.current?.value.trim() ?? '';
    if (name && name.length <= 100) return;
    event.preventDefault();
    event.stopPropagation();
    if (list && !name) {
      setRestored(true);
      if (input.current) input.current.value = list.name;
      if (details.current) {
        details.current.open = false;
        details.current.querySelector('summary')?.focus();
      }
    } else {
      setInvalid(true);
      input.current?.focus();
    }
  }

  const form = (
    <div onSubmitCapture={submit}>
      <ActionForm
        action={action}
        label={list ? t.save : itemListId ? t.newItem : t.newList}
        pendingLabel={t.saving}
      >
        {itemListId && <input type="hidden" name="list_id" value={itemListId} />}
        {list && <input type="hidden" name="list_id" value={list.id} />}
        <label>
          {t.name}
          <input
            ref={input}
            name="name"
            required={!list}
            maxLength={100}
            defaultValue={list?.name}
            aria-invalid={invalid}
            aria-describedby={invalid ? errorId : undefined}
            style={
              invalid ? { borderColor: 'var(--danger)', outlineColor: 'var(--danger)' } : undefined
            }
            onInvalid={() => setInvalid(true)}
            onInput={() => {
              setInvalid(false);
              setRestored(false);
            }}
          />
        </label>
        {invalid && (
          <p id={errorId} className="notice error" role="alert">
            {itemListId ? t.productNameInvalid : t.listNameInvalid}
          </p>
        )}
      </ActionForm>
    </div>
  );
  return list ? (
    <>
      <details ref={details}>
        <summary>{t.rename}</summary>
        {form}
      </details>
      {restored && (
        <p className="notice" role="status">
          {t.listNameRestored}
        </p>
      )}
    </>
  ) : (
    form
  );
}
