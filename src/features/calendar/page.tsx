import { getHome, requireUser } from '@/lib/data';
import { i18n } from '@/lib/i18n/server';
import { homeDate } from '@/lib/timezones';
import { validDate, addDays } from '@/features/organization/logic';
import { calendarMessages } from './messages';
import { calendarRows } from './queries';
import { normalizeCalendar, adjacentMonth } from './logic';
import { CalendarView } from './calendar-view';
export async function CalendarPage({
  homeId,
  search,
}: {
  homeId: string;
  search: Record<string, string | string[] | undefined>;
}) {
  const home = await getHome(homeId),
    { db, user } = await requireUser(),
    { locale } = await i18n(),
    t = calendarMessages(locale),
    today = homeDate(home.timezone),
    requested = typeof search.month === 'string' ? search.month : '';
  const month =
      /^\d{4}-\d{2}$/.test(requested) &&
      validDate(`${requested}-01`) &&
      requested >= '1900-01' &&
      requested <= '9998-12'
        ? requested
        : today.slice(0, 7),
    first = `${month}-01`,
    end = `${adjacentMonth(month, 1)}-01`;
  // Wide UTC bounds cover all IANA offsets; exact day membership is evaluated in the home zone.
  const fromInstant = `${addDays(first, -2)}T00:00:00Z`,
    throughInstant = `${addDays(end, 2)}T00:00:00Z`;
  const selected =
    typeof search.day === 'string' && validDate(search.day) && search.day.startsWith(month)
      ? search.day
      : today.startsWith(month)
        ? today
        : first;
  const check = await db.from('reservations').select('id').eq('home_id', homeId).limit(1);
  if (check.error)
    return (
      <p className="notice error" role="alert">
        {['42P01', 'PGRST205'].includes(check.error.code) ? t.migration : t.error}
      </p>
    );
  const [tasks, reservations, activities, members, recurring, occurrences] = await Promise.all([
    calendarRows(
      db
        .from('chore_instances')
        .select('*')
        .eq('home_id', homeId)
        .is('cancelled_at', null)
        .or(
          `and(deadline_at.gte.${fromInstant},deadline_at.lt.${throughInstant}),and(deadline_at.is.null,period_start.gte.${first},period_start.lt.${end})`,
        )
        .order('id'),
    ),
    calendarRows(
      db
        .from('reservations')
        .select('*')
        .eq('home_id', homeId)
        .is('cancelled_at', null)
        .lt('starts_at', throughInstant)
        .gt('ends_at', fromInstant)
        .order('id'),
    ),
    calendarRows(
      db
        .from('activities')
        .select('*')
        .eq('home_id', homeId)
        .is('cancelled_at', null)
        .lt('starts_at', throughInstant)
        .or(`ends_at.gt.${fromInstant},starts_at.gte.${fromInstant}`)
        .order('id'),
    ),
    calendarRows(
      db
        .from('activity_members')
        .select('*')
        .eq('home_id', homeId)
        .eq('attending', true)
        .order('activity_id')
        .order('user_id'),
    ),
    calendarRows(
      db
        .from('recurring_expenses')
        .select('*')
        .eq('home_id', homeId)
        .eq('active', true)
        .gte('next_date', first)
        .lt('next_date', end)
        .order('id'),
    ),
    calendarRows(
      db
        .from('recurring_expense_instances')
        .select('*')
        .eq('home_id', homeId)
        .eq('status', 'pending')
        .gte('period_date', first)
        .lt('period_date', end)
        .order('id'),
    ),
  ]);
  const events = normalizeCalendar(
    { homeId, tasks, reservations, activities, members, recurring, occurrences },
    new Date().toISOString(),
  );
  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <h1>{t.calendar}</h1>
          <p>
            {t.timezone}: <strong>{home.timezone}</strong>
          </p>
        </div>
      </header>
      <CalendarView
        homeId={homeId}
        month={month}
        selectedDay={selected}
        timezone={home.timezone}
        weekStart={home.week_starts_on}
        locale={locale}
        userId={user.id}
        events={events}
      />
      <p>{t.sourceHelp}</p>
    </div>
  );
}
