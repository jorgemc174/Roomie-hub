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
  const details = useRef<HTMLDetailsElement>(null);
  return (
    <details ref={details}>
      <summary>{t.listDelete}</summary>
      <ActionForm action={action} label={t.delete} pendingLabel={t.saving} danger>
        <input type="hidden" name="list_id" value={listId} />
        <p>{t.deleteListPrompt}</p>
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            if (details.current) {
              details.current.open = false;
              details.current.querySelector('summary')?.focus();
            }
          }}
        >
          {t.cancel}
        </button>
      </ActionForm>
    </details>
  );
}

// Keep ActionForm's pending/error handling and retained drafts in both modes.
export function ShoppingListNameForm({
  action,
  t,
  list,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  t: OrganizationMessages;
  list?: { id: string; name: string };
}) {
  const input = useRef<HTMLInputElement>(null);
  const details = useRef<HTMLDetailsElement>(null);
  const [invalid, setInvalid] = useState(false);
  const errorId = useId();

  function submit(event: FormEvent<HTMLDivElement>) {
    if (input.current?.value.trim()) return;
    event.preventDefault();
    event.stopPropagation();
    if (list) {
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
      <ActionForm action={action} label={list ? t.save : t.newList} pendingLabel={t.saving}>
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
            onInput={() => setInvalid(false)}
          />
        </label>
        {invalid && (
          <p id={errorId} className="notice error" role="alert">
            {t.shoppingInvalid}
          </p>
        )}
      </ActionForm>
    </div>
  );
  return list ? (
    <details ref={details}>
      <summary>{t.rename}</summary>
      {form}
    </details>
  ) : (
    form
  );
}
