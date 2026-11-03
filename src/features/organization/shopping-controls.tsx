'use client';

import { useEffect, useRef } from 'react';
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
