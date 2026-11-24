'use client';
import { CreatePanel } from '@/components/ui/create-panel';
import type { Locale } from '@/lib/i18n/dictionaries';
import { CalendarForm } from './form';
import { ActivityFields, ReservationFields } from './fields';
import { calendarMessages } from './messages';
import { dayDefaults } from './logic';
import type { CalendarManage } from './models';

// Creation starts from the selected day; the forms reuse the calendar action and its RPCs.
export function DayCreate({
  homeId,
  locale,
  timezone,
  userId,
  day,
  today,
  resource,
  manage,
}: {
  homeId: string;
  locale: Locale;
  timezone: string;
  userId: string;
  day: string;
  today: string;
  resource: string;
  manage: CalendarManage;
}) {
  const t = calendarMessages(locale);
  const defaults = dayDefaults(day, today, manage.nowLocal);
  if (!defaults) return <p className="notice">{t.pastDay}</p>;
  const active = manage.resources.filter((x) => x.active);
  return (
    <div className="grid items-start gap-3 md:grid-cols-2">
      <CreatePanel
        title={t.newActivity}
        closeLabel={manage.closeLabel}
        id="create-activity"
        defaultOpen={manage.create === 'activity'}
      >
        <p>{t.selectedDayHelp}</p>
        <p>{t.creatorJoins}</p>
        <CalendarForm
          homeId={homeId}
          operation="activity"
          id={manage.createIds.activity}
          timezone={timezone}
          locale={locale}
          label={t.save}
        >
          <ActivityFields
            locale={locale}
            timezone={timezone}
            userId={userId}
            people={manage.people}
            day={day}
            startTime={defaults.activity}
          />
        </CalendarForm>
      </CreatePanel>
      <CreatePanel
        title={t.newReservation}
        closeLabel={manage.closeLabel}
        id="create-reservation"
        defaultOpen={manage.create === 'reservation'}
      >
        {active.length ? (
          <>
            <p>{t.selectedDayHelp}</p>
            <p>{t.reservationHelp}</p>
            <CalendarForm
              homeId={homeId}
              operation="reservation"
              id={manage.createIds.reservation}
              timezone={timezone}
              locale={locale}
              label={t.save}
            >
              <ReservationFields
                locale={locale}
                timezone={timezone}
                userId={userId}
                people={manage.people}
                resources={manage.resources}
                resource={active.some((x) => x.id === resource) ? resource : ''}
                day={day}
                startTime={defaults.reservationStart}
                endTime={defaults.reservationEnd}
              />
            </CalendarForm>
          </>
        ) : (
          <>
            <p className="notice">{t.noResources}</p>
            <CalendarForm
              homeId={homeId}
              operation="initialize"
              id={manage.createIds.reservation}
              locale={locale}
              label={t.initialize}
            />
            <p>{t.resourcesInOptions}</p>
          </>
        )}
      </CreatePanel>
    </div>
  );
}
