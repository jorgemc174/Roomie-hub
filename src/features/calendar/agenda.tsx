'use client';
import { ActivityCard, ReservationCard } from './event-card';
import { DayCreate } from './day-create';
import { EventLink } from './event-link';
import { calendarMessages } from './messages';
import type { CalendarAgendaProps } from './models';

// The selected day's agenda: create from that day, manage activities and reservations in
// place and keep tasks and expenses as links to their own section.
export function ManagedAgenda({
  homeId,
  locale,
  timezone,
  userId,
  day,
  today,
  resource,
  events,
  manage,
}: CalendarAgendaProps) {
  const t = calendarMessages(locale);
  const shared = { homeId, locale, timezone, userId, now: manage.now };
  return (
    <>
      <DayCreate
        homeId={homeId}
        locale={locale}
        timezone={timezone}
        userId={userId}
        day={day}
        today={today}
        resource={resource}
        manage={manage}
      />
      {!events.length && <p>{t.noEvents}</p>}
      <ul className="calendar-agenda">
        {events.map((event) => {
          const activity =
            event.sourceType === 'activities'
              ? manage.activities.find((a) => a.id === event.sourceId)
              : undefined;
          if (activity)
            return (
              <ActivityCard
                key={event.id}
                {...shared}
                activity={activity}
                participants={manage.participants}
                people={manage.people}
              />
            );
          const reservation =
            event.sourceType === 'reservations'
              ? manage.reservations.find((r) => r.id === event.sourceId)
              : undefined;
          if (reservation)
            return (
              <ReservationCard
                key={event.id}
                {...shared}
                reservation={reservation}
                resources={manage.resources}
                people={manage.people}
              />
            );
          return <EventLink key={event.id} event={event} locale={locale} timezone={timezone} />;
        })}
      </ul>
    </>
  );
}
