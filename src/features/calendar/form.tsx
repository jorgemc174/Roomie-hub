'use client';
import { useActionState, useState, type ReactNode } from 'react';
import { calendarAction } from './actions';
import { calendarMessages } from './messages';
import type { Locale } from '@/lib/i18n/dictionaries';
export function CalendarForm({
  homeId,
  operation,
  id,
  version = 0,
  timezone,
  locale,
  label,
  children,
}: {
  homeId: string;
  operation: string;
  id: string;
  version?: number;
  timezone?: string;
  locale: Locale;
  label: string;
  children?: ReactNode;
}) {
  const [request] = useState({ id, version, timezone });
  const t = calendarMessages(locale);
  const [state, action, pending] = useActionState(calendarAction.bind(null, homeId, operation), {});
  return (
    <form className="form" action={action}>
      <fieldset disabled={pending || Boolean(state.success)}>
        <input type="hidden" name="id" value={request.id} />
        <input type="hidden" name="version" value={request.version} />
        {request.timezone && <input type="hidden" name="timezone" value={request.timezone} />}
        {children}
      </fieldset>
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
      <button className="button" disabled={pending || Boolean(state.success)}>
        {pending ? t.saving : label}
      </button>
      {state.success && (
        <button className="button secondary" type="button" onClick={() => window.location.reload()}>
          {t.reload}
        </button>
      )}
    </form>
  );
}
