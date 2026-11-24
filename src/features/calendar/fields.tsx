'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import type { Locale } from '@/lib/i18n/dictionaries';
import { ActivityLocationFields } from './activity-location-fields';
import { calendarMessages } from './messages';
import { localInput } from './logic';
import type {
  ActivityView,
  ParticipantView,
  Person,
  ReservationView,
  ResourceOption,
} from './models';

// A new record follows the selected day. A date the person moved to another day is kept,
// as is any time they typed; the field stays uncontrolled so drafts survive failed saves.
export function DayDateTime({
  name,
  label,
  day,
  time,
  required = false,
}: {
  name: string;
  label: string;
  day: string;
  time?: string;
  required?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const shown = useRef(day);
  useEffect(() => {
    const element = input.current;
    if (!element || shown.current === day) return;
    if (element.value.startsWith(`${shown.current}T`))
      element.value = `${day}${element.value.slice(10)}`;
    shown.current = day;
  }, [day]);
  return (
    <label>
      {label}
      <input
        ref={input}
        name={name}
        type="datetime-local"
        step={1}
        required={required}
        defaultValue={time ? `${day}T${time}` : ''}
      />
    </label>
  );
}

// A new reservation follows the calendar's resource filter until the person picks another
// resource. The form is mounted with the page, so the filter can change before it opens.
function FilteredResource({ resource, children }: { resource: string; children: ReactNode }) {
  const select = useRef<HTMLSelectElement>(null);
  const chosen = useRef(false);
  useEffect(() => {
    const element = select.current;
    if (!element || chosen.current || !resource) return;
    if (Array.from(element.options).some((o) => o.value === resource && !o.disabled))
      element.value = resource;
  }, [resource]);
  return (
    <select
      ref={select}
      name="resource"
      required
      defaultValue={resource}
      onChange={() => {
        chosen.current = true;
      }}
    >
      {children}
    </select>
  );
}

export function ActivityFields({
  locale,
  timezone,
  userId,
  people,
  activity,
  participants = [],
  day = '',
  startTime,
}: {
  locale: Locale;
  timezone: string;
  userId: string;
  people: Person[];
  activity?: ActivityView;
  participants?: ParticipantView[];
  day?: string;
  startTime?: string;
}) {
  const t = calendarMessages(locale);
  const creator = activity?.created_by ?? userId;
  // Existing participants keep their own answer: editing can add people, never reset them.
  const joined = new Set(participants.map((p) => p.user_id));
  return (
    <>
      <label>
        {t.title}
        <input name="title" required maxLength={160} defaultValue={activity?.title ?? ''} />
      </label>
      <label>
        {t.description}
        <textarea name="description" maxLength={4000} defaultValue={activity?.description ?? ''} />
      </label>
      <ActivityLocationFields
        locale={locale}
        initialKind={activity?.location_kind ?? ''}
        initialPlace={activity?.location ?? ''}
      />
      <fieldset>
        <legend>{t.selectParticipants}</legend>
        <p>{t.participantHelp}</p>
        {people
          .filter((m) => m.user_id !== creator)
          .map((m) => (
            <label className="checkbox" key={m.user_id}>
              <input
                type="checkbox"
                name="participants"
                value={m.user_id}
                disabled={joined.has(m.user_id)}
                defaultChecked={joined.has(m.user_id)}
              />
              {m.name}
            </label>
          ))}
      </fieldset>
      {activity ? (
        <>
          <label>
            {t.start}
            <input
              name="start"
              type="datetime-local"
              step={1}
              required
              defaultValue={localInput(activity.starts_at, timezone)}
            />
          </label>
          <label>
            {t.optionalEnd}
            <input
              name="end"
              type="datetime-local"
              step={1}
              defaultValue={activity.ends_at ? localInput(activity.ends_at, timezone) : ''}
            />
          </label>
        </>
      ) : (
        <>
          <DayDateTime name="start" label={t.start} day={day} time={startTime} required />
          <DayDateTime name="end" label={t.optionalEnd} day={day} />
        </>
      )}
      <details className="ui-help">
        <summary>
          {t.timezone}: {timezone}
        </summary>
        <p>{t.timeHelp}</p>
      </details>
    </>
  );
}

export function ReservationFields({
  locale,
  timezone,
  userId,
  people,
  resources,
  reservation,
  resource = '',
  day = '',
  startTime,
  endTime,
}: {
  locale: Locale;
  timezone: string;
  userId: string;
  people: Person[];
  resources: ResourceOption[];
  reservation?: ReservationView;
  resource?: string;
  day?: string;
  startTime?: string;
  endTime?: string;
}) {
  const t = calendarMessages(locale);
  const options = resources
    .filter((x) => x.active || x.id === reservation?.resource_id)
    .map((x) => (
      <option key={x.id} value={x.id} disabled={!x.active}>
        {x.name}
        {x.active ? '' : ` · ${t.inactive}`}
      </option>
    ));
  return (
    <>
      <label>
        {t.resource}
        {reservation ? (
          <select name="resource" required defaultValue={reservation.resource_id}>
            {options}
          </select>
        ) : (
          <FilteredResource resource={resource}>{options}</FilteredResource>
        )}
      </label>
      <label>
        {t.responsible}
        <select name="person" defaultValue={reservation?.responsible_id ?? userId}>
          {people.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t.title}
        <input name="title" maxLength={160} defaultValue={reservation?.title ?? ''} />
      </label>
      {reservation ? (
        <>
          <label>
            {t.start}
            <input
              name="start"
              type="datetime-local"
              step={1}
              required
              defaultValue={localInput(reservation.starts_at, timezone)}
            />
          </label>
          <label>
            {t.end}
            <input
              name="end"
              type="datetime-local"
              step={1}
              required
              defaultValue={localInput(reservation.ends_at, timezone)}
            />
          </label>
        </>
      ) : (
        <>
          <DayDateTime name="start" label={t.start} day={day} time={startTime} required />
          <DayDateTime name="end" label={t.end} day={day} time={endTime} required />
        </>
      )}
    </>
  );
}
