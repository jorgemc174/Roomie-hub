'use client';
import { useActionState } from 'react';
import { FormFeedback } from '@/components/ui/form-feedback';
import type { Locale } from '@/lib/i18n/dictionaries';
import { calendarAction } from './actions';
import { calendarMessages } from './messages';
import type { ActivityMember } from './models';

export function ActivityResponseForm({
  homeId,
  id,
  locale,
  response,
}: {
  homeId: string;
  id: string;
  locale: Locale;
  response: ActivityMember['response'] | '';
}) {
  const t = calendarMessages(locale);
  const [state, action, pending] = useActionState(calendarAction.bind(null, homeId, 'attend'), {});
  return (
    <form className="form" action={action} aria-busy={pending}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value="0" />
      <fieldset disabled={pending}>
        <legend>{t.yourResponse}</legend>
        <div className="row wrap">
          {(['going', 'maybe', 'not_going'] as const).map((answer) => (
            <button
              key={answer}
              type="submit"
              name="response"
              value={answer}
              className={response === answer ? 'button' : 'button secondary'}
              aria-pressed={response === answer}
            >
              {t[answer]}
            </button>
          ))}
        </div>
      </fieldset>
      {pending && <p role="status">{t.saving}</p>}
      <FormFeedback error={state.error} success={state.success} pending={pending} />
    </form>
  );
}
