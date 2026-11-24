'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { readCalendarNavigation, calendarNavigationHref, type CalendarChanges } from './navigation';
import type { ComponentType } from 'react';
import type { Locale } from '@/lib/i18n/dictionaries';
import type { CalendarAgendaProps, CalendarEvent, CalendarManage } from './models';
import { calendarMessages } from './messages';
import { EventLink } from './event-link';
import { adjacentMonth, eventSources, monthDays, filterEvents, eventOnDay } from './logic';
export function CalendarView({
  homeId,
  month,
  selectedDay,
  today,
  timezone,
  weekStart,
  locale,
  userId,
  events,
  manage,
  Agenda,
}: {
  homeId: string;
  month: string;
  selectedDay: string;
  today: string;
  timezone: string;
  weekStart: number;
  locale: Locale;
  userId: string;
  events: CalendarEvent[];
  manage?: CalendarManage;
  // Injected by ManagedCalendar: creation and management of the selected day's records.
  Agenda?: ComponentType<CalendarAgendaProps>;
}) {
  const t = calendarMessages(locale),
    search = useSearchParams();
  const { day, types, mine, resource } = readCalendarNavigation(search, month, selectedDay);
  const resources = manage?.resources ?? [];
  const resourceName = resources.find((x) => x.id === resource)?.name;
  const filtered = filterEvents(events, types, mine, userId, resourceName ? resource : ''),
    days = monthDays(month, weekStart),
    agenda = filtered.filter((e) => eventOnDay(e, day, timezone));
  const label = (d: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(
      new Date(`${d}T12:00:00Z`),
    );
  const base = `/homes/${homeId}/calendar`;
  // A record deep link or an opened creation panel applies once; later states are explicit.
  const transient: CalendarChanges = { item: null, create: null };
  const href = (changes: CalendarChanges) =>
    calendarNavigationHref(base, search, { ...transient, ...changes });
  function update(changes: CalendarChanges) {
    const next = href({ month, day, ...changes });
    if (`${window.location.pathname}${window.location.search}` === next) return;
    // Day/filter selection is not a new screen: keep Back free of intermediate clicks.
    window.history.replaceState(null, '', next);
  }
  return (
    <div className="calendar-view stack">
      <div className="calendar-toolbar">
        <details className="calendar-filter-panel">
          <summary>
            {t.filter} · {types.length}
            {mine ? ` · ${t.mine}` : ''}
            {resourceName ? ` · ${resourceName}` : ''}
          </summary>
          <fieldset className="calendar-filters">
            <legend className="sr-only">{t.filter}</legend>
            {eventSources.map((type) => (
              <label className="checkbox" key={type}>
                <input
                  type="checkbox"
                  checked={types.includes(type)}
                  onChange={(e) =>
                    update({
                      types: (e.target.checked
                        ? eventSources.filter((x) => types.includes(x) || x === type)
                        : types.filter((x) => x !== type)
                      ).join(','),
                    })
                  }
                />
                <span className={`event-kind kind-${type}`}>{t[type]}</span>
              </label>
            ))}
            <label className="checkbox">
              <input
                type="checkbox"
                checked={mine}
                onChange={(e) => update({ mine: e.target.checked ? '1' : null })}
              />
              {t.mine}
            </label>
            {resources.length > 0 && (
              <label>
                {t.resource}
                <select
                  value={resourceName ? resource : ''}
                  onChange={(e) => update({ resource: e.target.value || null })}
                >
                  <option value="">{t.allResources}</option>
                  {resources.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                      {x.active ? '' : ` · ${t.inactive}`}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </fieldset>
        </details>
        <div className="calendar-quick-actions">
          <Link
            className="button secondary"
            href={href({ month: today.slice(0, 7), day: today })}
            onNavigate={(event) => {
              if (today.startsWith(month)) {
                event.preventDefault();
                if (day !== today || search.has('item') || search.has('create'))
                  update({ month: today.slice(0, 7), day: today });
              }
            }}
          >
            {t.today}
          </Link>
        </div>
      </div>
      <section className="panel calendar-month">
        <div className="calendar-month-heading">
          <Link
            className="button secondary"
            href={href({ month: adjacentMonth(month, -1), day: null })}
            aria-label={t.previous}
          >
            ←
          </Link>
          <h2>{label(`${month}-01`, { month: 'long', year: 'numeric' })}</h2>
          <Link
            className="button secondary"
            href={href({ month: adjacentMonth(month, 1), day: null })}
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
                className={`calendar-day ${d === day ? 'selected' : ''} ${d === today ? 'today' : ''}`}
                aria-current={d === today ? 'date' : undefined}
                aria-pressed={d === day}
                aria-label={`${label(d, { dateStyle: 'full' })}: ${count} ${t.events}`}
                onClick={() => {
                  if (d !== day || search.has('item') || search.has('create')) update({ day: d });
                }}
              >
                <span>{Number(d.slice(8))}</span>
                {count > 0 && <span className="calendar-count">{count}</span>}
              </button>
            );
          })}
        </div>
      </section>
      <section className="stack" aria-labelledby="calendar-agenda-heading">
        <h2 id="calendar-agenda-heading" aria-live="polite">
          {t.agenda} · {label(day, { dateStyle: 'long' })}
        </h2>
        {Agenda && manage ? (
          <Agenda
            homeId={homeId}
            locale={locale}
            timezone={timezone}
            userId={userId}
            day={day}
            today={today}
            resource={resourceName ? resource : ''}
            events={agenda}
            manage={manage}
          />
        ) : (
          <>
            {!agenda.length && <p>{t.noEvents}</p>}
            <ul className="calendar-agenda">
              {agenda.map((event) => (
                <EventLink key={event.id} event={event} locale={locale} timezone={timezone} />
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
