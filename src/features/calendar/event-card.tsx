'use client';
import type { Locale } from '@/lib/i18n/dictionaries';
import { CalendarForm } from './form';
import { ActivityResponseForm } from './activity-response-form';
import { ActivityFields, ReservationFields } from './fields';
import { calendarMessages } from './messages';
import { formatInstant } from './logic';
import type {
  ActivityView,
  ParticipantView,
  Person,
  ReservationView,
  ResourceOption,
} from './models';

type Shared = { homeId: string; locale: Locale; timezone: string; userId: string; now: string };

function CancelDetails({
  homeId,
  locale,
  operation,
  id,
  version,
}: {
  homeId: string;
  locale: Locale;
  operation: 'cancel_activity' | 'cancel_reservation';
  id: string;
  version: number;
}) {
  const t = calendarMessages(locale);
  return (
    <details>
      <summary>{t.cancel}</summary>
      <CalendarForm
        homeId={homeId}
        operation={operation}
        id={id}
        version={version}
        locale={locale}
        label={t.cancel}
      >
        <label className="checkbox">
          <input name="confirm" type="checkbox" required />
          {t.cancelConfirm}
        </label>
      </CalendarForm>
    </details>
  );
}

// Details, participation, editing and cancellation of one activity, as in the former list.
export function ActivityCard({
  homeId,
  locale,
  timezone,
  userId,
  now,
  activity: a,
  participants,
  people,
}: Shared & { activity: ActivityView; participants: ParticipantView[]; people: Person[] }) {
  const t = calendarMessages(locale);
  const own = participants.filter((m) => m.activity_id === a.id);
  const response = own.find((m) => m.user_id === userId)?.response ?? '';
  return (
    <li className="calendar-event kind-activities" id={`activity-${a.id}`}>
      <article className="grid gap-3 p-4" aria-labelledby={`activity-${a.id}-title`}>
        <p className="row wrap">
          <span className="badge kind-activities">{t.activities}</span>
          {a.cancelled_at && <span className="badge cancelled">{t.cancelled}</span>}
        </p>
        <h3 id={`activity-${a.id}-title`}>{a.title}</h3>
        <p>
          {formatInstant(a.starts_at, timezone, locale)}
          {a.ends_at ? ` → ${formatInstant(a.ends_at, timezone, locale)}` : ''}
        </p>
        <p>
          <span className="badge">
            {a.location_kind === 'outside'
              ? t.outsideHome
              : a.location_kind === 'home'
                ? t.atHome
                : t.unspecifiedLocation}
          </span>
        </p>
        {a.location && <p>{a.location}</p>}
        {a.description && <p style={{ whiteSpace: 'pre-wrap' }}>{a.description}</p>}
        <small>
          {t.creator}: {a.created_by_name}
        </small>
        <section className="grid gap-2" aria-labelledby={`activity-${a.id}-participants`}>
          <h4 id={`activity-${a.id}-participants`} className="font-semibold">
            {t.participants}
          </h4>
          {(['going', 'maybe', 'not_going'] as const).map((answer) => {
            const respondents = own.filter((m) => m.response === answer);
            return (
              <section key={answer}>
                <h5 className="font-semibold">
                  {t[answer]} ({new Intl.NumberFormat(locale).format(respondents.length)})
                </h5>
                {respondents.length ? (
                  <ul>
                    {respondents.map((m) => (
                      <li key={m.user_id}>{m.user_name}</li>
                    ))}
                  </ul>
                ) : (
                  <p>{t.noResponses}</p>
                )}
              </section>
            );
          })}
        </section>
        {!a.cancelled_at && (
          <>
            {Date.parse(a.ends_at ?? a.starts_at) > Date.parse(now) && (
              <ActivityResponseForm homeId={homeId} id={a.id} locale={locale} response={response} />
            )}
            <details>
              <summary>{t.edit}</summary>
              <CalendarForm
                homeId={homeId}
                operation="activity"
                id={a.id}
                version={a.version}
                timezone={timezone}
                locale={locale}
                label={t.save}
              >
                <ActivityFields
                  locale={locale}
                  timezone={timezone}
                  userId={userId}
                  people={people}
                  activity={a}
                  participants={own}
                />
              </CalendarForm>
            </details>
            <CancelDetails
              homeId={homeId}
              locale={locale}
              operation="cancel_activity"
              id={a.id}
              version={a.version}
            />
          </>
        )}
      </article>
    </li>
  );
}

export function ReservationCard({
  homeId,
  locale,
  timezone,
  userId,
  now,
  reservation: b,
  resources,
  people,
}: Shared & { reservation: ReservationView; resources: ResourceOption[]; people: Person[] }) {
  const t = calendarMessages(locale);
  return (
    <li className="calendar-event kind-reservations" id={`reservation-${b.id}`}>
      <article className="grid gap-3 p-4" aria-labelledby={`reservation-${b.id}-title`}>
        <p className="row wrap">
          <span className="badge kind-reservations">{t.reservations}</span>
          {b.cancelled_at && <span className="badge cancelled">{t.cancelled}</span>}
        </p>
        <h3 id={`reservation-${b.id}-title`}>
          {b.resource_name}
          {b.title ? ` · ${b.title}` : ''}
        </h3>
        <p>
          {formatInstant(b.starts_at, timezone, locale)} →{' '}
          {formatInstant(b.ends_at, timezone, locale)}
        </p>
        <p>
          {t.responsible}: {b.responsible_name}
        </p>
        {!b.cancelled_at && (
          <>
            {Date.parse(b.ends_at) > Date.parse(now) && (
              <details>
                <summary>{t.edit}</summary>
                <CalendarForm
                  homeId={homeId}
                  operation="reservation"
                  id={b.id}
                  version={b.version}
                  timezone={timezone}
                  locale={locale}
                  label={t.save}
                >
                  <ReservationFields
                    locale={locale}
                    timezone={timezone}
                    userId={userId}
                    people={people}
                    resources={resources}
                    reservation={b}
                  />
                </CalendarForm>
              </details>
            )}
            <CancelDetails
              homeId={homeId}
              locale={locale}
              operation="cancel_reservation"
              id={b.id}
              version={b.version}
            />
          </>
        )}
      </article>
    </li>
  );
}
