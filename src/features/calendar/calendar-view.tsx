'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { Locale } from '@/lib/i18n/dictionaries';
import type { CalendarEvent, EventSource } from './models';
import { calendarMessages } from './messages';
import {
  adjacentMonth,
  eventSources,
  monthDays,
  filterEvents,
  eventOnDay,
  formatInstant,
} from './logic';
export function CalendarView({
  homeId,
  month,
  selectedDay,
  timezone,
  weekStart,
  locale,
  userId,
  events,
}: {
  homeId: string;
  month: string;
  selectedDay: string;
  timezone: string;
  weekStart: number;
  locale: Locale;
  userId: string;
  events: CalendarEvent[];
}) {
  const t = calendarMessages(locale),
    [types, setTypes] = useState<EventSource[]>(eventSources),
    [mine, setMine] = useState(false),
    [selected, setSelected] = useState(selectedDay);
  const day = selected.startsWith(month) ? selected : selectedDay,
    filtered = filterEvents(events, types, mine, userId),
    days = monthDays(month, weekStart),
    agenda = filtered.filter((e) => eventOnDay(e, day, timezone));
  const label = (d: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(
      new Date(`${d}T12:00:00Z`),
    );
  const base = `/homes/${homeId}/calendar`;
  return (
    <div className="calendar-view stack">
      <fieldset className="calendar-filters">
        <legend>{t.filter}</legend>
        {eventSources.map((type) => (
          <label className="checkbox" key={type}>
            <input
              type="checkbox"
              checked={types.includes(type)}
              onChange={(e) =>
                setTypes(e.target.checked ? [...types, type] : types.filter((x) => x !== type))
              }
            />
            <span className={`event-kind kind-${type}`}>{t[type]}</span>
          </label>
        ))}
        <label className="checkbox">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          {t.mine}
        </label>
      </fieldset>
      <section className="panel calendar-month">
        <div className="calendar-month-heading">
          <Link
            className="button secondary"
            href={`${base}?month=${adjacentMonth(month, -1)}`}
            aria-label={t.previous}
          >
            ←
          </Link>
          <h2>{label(`${month}-01`, { month: 'long', year: 'numeric' })}</h2>
          <Link
            className="button secondary"
            href={`${base}?month=${adjacentMonth(month, 1)}`}
            aria-label={t.next}
          >
            →
          </Link>
        </div>
        <div className="calendar-weekdays" aria-hidden="true">
          {days.slice(0, 7).map((d) => (
            <span key={d}>{label(d, { weekday: 'short' })}</span>
          ))}
        </div>
        <div className="calendar-grid" role="group" aria-label={t.calendar}>
          {days.map((d) => {
            const count = filtered.filter((e) => eventOnDay(e, d, timezone)).length;
            return (
              <button
                type="button"
                key={d}
                disabled={!d.startsWith(month)}
                className={`calendar-day ${d === day ? 'selected' : ''}`}
                aria-pressed={d === day}
                aria-label={`${label(d, { dateStyle: 'full' })}: ${count} ${t.events}`}
                onClick={() => setSelected(d)}
              >
                <span>{Number(d.slice(8))}</span>
                {count > 0 && <span className="calendar-count">{count}</span>}
              </button>
            );
          })}
        </div>
      </section>
      <section className="panel" aria-live="polite">
        <h2>
          {t.agenda} · {label(day, { dateStyle: 'long' })}
        </h2>
        {!agenda.length && <p>{t.noEvents}</p>}
        <ul className="calendar-agenda">
          {agenda.map((event) => (
            <li key={event.id} className={`calendar-event kind-${event.sourceType}`}>
              <Link href={event.href}>
                <div>
                  <span className="badge">{t[event.sourceType]}</span>{' '}
                  <span>{t[event.status]}</span>
                </div>
                <h3>{event.title}</h3>
                <p>
                  {event.allDay ? t.allDay : formatInstant(event.startsAt, timezone, locale)}
                  {event.endsAt && !event.allDay
                    ? ` → ${formatInstant(event.endsAt, timezone, locale)}`
                    : ''}
                </p>
                {event.names.length > 0 && <p>{event.names.join(', ')}</p>}
                {event.location && <p>{event.location}</p>}
                <small>{t.details} →</small>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
