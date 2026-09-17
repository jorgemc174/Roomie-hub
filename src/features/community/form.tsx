'use client';
import { useActionState, useState, type ReactNode } from 'react';
import type { Locale } from '@/lib/i18n/dictionaries';
import { communityAction } from './actions';
import { communityMessages } from './messages';
import type { Rating, RatingReason } from './models';
export function CommunityForm({
  homeId,
  operation,
  id,
  version = 0,
  locale,
  label,
  children,
}: {
  homeId: string;
  operation: string;
  id: string;
  version?: number;
  locale: Locale;
  label: string;
  children?: ReactNode;
}) {
  const [request] = useState({ id, version }),
    [state, action, pending] = useActionState(communityAction.bind(null, homeId, operation), {}),
    t = communityMessages(locale);
  return (
    <form className="form" action={action}>
      <fieldset disabled={pending || Boolean(state.success)}>
        <input type="hidden" name="id" value={request.id} />
        <input type="hidden" name="version" value={request.version} />
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
export function RatingFields({
  reasons,
  locale,
  rating,
  mine,
}: {
  reasons: RatingReason[];
  locale: Locale;
  rating?: Rating;
  mine?: boolean;
}) {
  const t = communityMessages(locale),
    [kind, setKind] = useState(rating?.kind ?? 'positive');
  return (
    <>
      <label>
        {t.kind}
        <select
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as 'positive' | 'negative')}
        >
          <option value="positive">{t.positive}</option>
          <option value="negative">{t.negative}</option>
        </select>
      </label>
      <label>
        {t.reason}
        <select
          key={kind}
          name="reason"
          required
          defaultValue={rating?.kind === kind ? (rating.reason_id ?? '') : ''}
        >
          <option value="" disabled>
            {t.reason}
          </option>
          {reasons
            .filter((r) => r.active && r.kind === kind)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.requires_text ? ' *' : ''}
              </option>
            ))}
        </select>
      </label>
      <label>
        {t.notes}
        <textarea name="notes" maxLength={2000} defaultValue={rating?.custom_text ?? ''} />
      </label>
      {rating?.is_anonymous && !mine ? (
        <>
          <input type="hidden" name="anonymous" value="on" />
          <p>{t.anonymousAuthor}</p>
        </>
      ) : (
        <label className="checkbox">
          <input name="anonymous" type="checkbox" defaultChecked={rating?.is_anonymous ?? false} />
          {t.anonymous}
        </label>
      )}
      <small>{t.anonymousHelp}</small>
      {!rating && (
        <>
          <label>
            {t.photo}
            <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" />
          </label>
          <small>{t.photoHelp}</small>
        </>
      )}
    </>
  );
}
