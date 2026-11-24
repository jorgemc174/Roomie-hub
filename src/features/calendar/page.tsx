import Link from 'next/link';
import { SectionTabs } from '@/components/section-tabs';
import { OptionsMenu } from '@/components/ui/options-menu';
import { PageHeader } from '@/components/ui/page-header';
import { getHome, getMembers, requireUser } from '@/lib/data';
import { i18n } from '@/lib/i18n/server';
import { homeDate } from '@/lib/timezones';
import { validDate, addDays } from '@/features/organization/logic';
import { calendarMessages } from './messages';
import {
  calendarRows,
  calendarItem,
  calendarListHref,
  calendarPageIndex,
  findCalendarItem,
  readActivityMembers,
  readActivityPage,
  readReservationPage,
  type CalendarKind,
  type CalendarListView,
} from './queries';
import { normalizeCalendar, adjacentMonth, localInput } from './logic';
import { ManagedCalendar } from './managed-calendar';
import { CalendarList } from './list-view';
import { ResourceSettings } from './resources';
import type { Member } from '@/lib/models';
import type {
  Activity,
  ActivityMember,
  ActivityView,
  ParticipantView,
  Reservation,
  ReservationView,
  Resource,
} from './models';

const activityView = (a: Activity): ActivityView => ({
  id: a.id,
  title: a.title,
  description: a.description,
  location: a.location,
  location_kind: a.location_kind,
  starts_at: a.starts_at,
  ends_at: a.ends_at,
  created_by: a.created_by,
  created_by_name: a.created_by_name,
  cancelled_at: a.cancelled_at,
  version: a.version,
});
const reservationView = (r: Reservation): ReservationView => ({
  id: r.id,
  resource_id: r.resource_id,
  resource_name: r.resource_name,
  title: r.title,
  responsible_id: r.responsible_id,
  responsible_name: r.responsible_name,
  starts_at: r.starts_at,
  ends_at: r.ends_at,
  cancelled_at: r.cancelled_at,
  version: r.version,
});
const participantView = (m: ActivityMember): ParticipantView => ({
  activity_id: m.activity_id,
  user_id: m.user_id,
  user_name: m.user_name,
  response: m.response,
});
const validMonth = (value: string) =>
  /^\d{4}-\d{2}$/.test(value) &&
  validDate(`${value}-01`) &&
  value >= '1900-01' &&
  value <= '9998-12';

export async function CalendarPage({
  homeId,
  search,
}: {
  homeId: string;
  search: Record<string, string | string[] | undefined>;
}) {
  const home = await getHome(homeId),
    { db, user } = await requireUser(),
    { locale, t: ui } = await i18n(),
    t = calendarMessages(locale),
    today = homeDate(home.timezone),
    now = new Date().toISOString(),
    base = `/homes/${homeId}/calendar`;
  const check = await db.from('reservations').select('id').eq('home_id', homeId).limit(1);
  if (check.error)
    return (
      <p className="notice error" role="alert">
        {['42P01', 'PGRST205'].includes(check.error.code) ? t.migration : t.error}
      </p>
    );
  const item = calendarItem(search.item);
  const target = item ? await findCalendarItem(db, homeId, item) : null;
  const requested: 'month' | CalendarListView =
    search.view === 'upcoming' || search.view === 'history' ? search.view : 'month';
  // A cancelled record has no place in the month grid, so its link opens it in history.
  const listItem = target && (requested !== 'month' || target.cancelled) ? item : undefined;
  const view = listItem && requested === 'month' ? 'history' : requested;
  const kind: CalendarKind = listItem
    ? target!.kind
    : search.kind === 'reservations'
      ? 'reservations'
      : 'activities';
  const resource = calendarItem(search.resource) ?? '';
  // Forms and filters need resources and active members; they load with each view's records.
  const shared = Promise.all([
    calendarRows(db.from('resources').select('*').eq('home_id', homeId).order('name').order('id')),
    getMembers(homeId),
  ]);
  const people = (members: Member[]) =>
    members.map((m) => ({ user_id: m.user_id, name: m.profiles?.name ?? '' }));
  const options = (resources: Resource[]) =>
    resources.map(({ id, name, active }) => ({ id, name, active }));
  const header = (resources: Resource[]) => (
    <>
      <PageHeader
        title={t.calendar}
        description={`${t.timezone}: ${home.timezone}`}
        action={
          <OptionsMenu label={`${t.calendar}: ${t.options}`}>
            <Link
              href={calendarListHref(base, { view: 'history', kind })}
              aria-current={view === 'history' ? 'page' : undefined}
            >
              {t.history}
            </Link>
            <ResourceSettings homeId={homeId} locale={locale} resources={resources} />
          </OptionsMenu>
        }
      />
      <div className="section-navigation">
        <SectionTabs
          label={t.calendar}
          items={[
            { href: base, label: t.month, current: view === 'month' },
            {
              href: calendarListHref(base, { view: 'upcoming', kind }),
              label: t.upcoming,
              current: view === 'upcoming',
            },
          ]}
        />
      </div>
      {item && !target && (
        <p className="notice" role="status">
          {t.missingItem}
        </p>
      )}
    </>
  );
  const help = (
    <details className="ui-help">
      <summary>{t.calendarHelp}</summary>
      <p>{t.sourceHelp}</p>
      <p>{t.timeHelp}</p>
    </details>
  );

  if (view !== 'month') {
    const page = listItem ? 0 : calendarPageIndex(search.page),
      // A focused record is shown whatever its state, as the former deep links did.
      listView = listItem ? 'all' : view;
    const [[resources, members], activityPage, reservationPage] = await Promise.all([
      shared,
      kind === 'activities'
        ? readActivityPage(db, homeId, { view: listView, now, page, item: listItem })
        : null,
      kind === 'reservations'
        ? readReservationPage(db, homeId, {
            view: listView,
            day: today,
            resource,
            now,
            page,
            item: listItem,
          })
        : null,
    ]);
    const participants = activityPage
      ? await readActivityMembers(
          db,
          homeId,
          activityPage.rows.map((a) => a.id),
        )
      : [];
    return (
      <div className="organization">
        {header(resources)}
        <CalendarList
          homeId={homeId}
          locale={locale}
          timezone={home.timezone}
          userId={user.id}
          now={now}
          view={view}
          kind={kind}
          resource={resource}
          item={listItem}
          page={page}
          hasMore={(activityPage ?? reservationPage)?.hasMore ?? false}
          activities={(activityPage?.rows ?? []).map(activityView)}
          participants={participants.map(participantView)}
          reservations={(reservationPage?.rows ?? []).map(reservationView)}
          resources={options(resources)}
          people={people(members)}
        />
        {help}
      </div>
    );
  }

  const focus = target && !listItem ? homeDate(home.timezone, target.startsAt) : '';
  const requestedMonth = typeof search.month === 'string' ? search.month : '';
  const month = validMonth(requestedMonth) ? requestedMonth : (focus || today).slice(0, 7),
    first = `${month}-01`,
    end = `${adjacentMonth(month, 1)}-01`;
  // Wide UTC bounds cover all IANA offsets; exact day membership is evaluated in the home zone.
  const fromInstant = `${addDays(first, -2)}T00:00:00Z`,
    throughInstant = `${addDays(end, 2)}T00:00:00Z`;
  const selected =
    typeof search.day === 'string' && validDate(search.day) && search.day.startsWith(month)
      ? search.day
      : focus.startsWith(month)
        ? focus
        : today.startsWith(month)
          ? today
          : first;
  const [[resources, members], tasks, reservations, activities, recurring, occurrences] =
    await Promise.all([
      shared,
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
  // Every answer of this month's activities: counters and names, never the whole home history.
  const participants = await readActivityMembers(
    db,
    homeId,
    activities.map((a) => a.id),
  );
  const events = normalizeCalendar(
    {
      homeId,
      tasks,
      reservations,
      activities,
      members: participants,
      recurring,
      occurrences,
      timezone: home.timezone,
    },
    now,
  );
  return (
    <div className="organization">
      {header(resources)}
      <ManagedCalendar
        homeId={homeId}
        month={month}
        selectedDay={selected}
        today={today}
        timezone={home.timezone}
        weekStart={home.week_starts_on}
        locale={locale}
        userId={user.id}
        events={events}
        manage={{
          activities: activities.map(activityView),
          participants: participants.map(participantView),
          reservations: reservations.map(reservationView),
          resources: options(resources),
          people: people(members),
          createIds: { activity: crypto.randomUUID(), reservation: crypto.randomUUID() },
          now,
          nowLocal: localInput(now, home.timezone),
          create:
            search.create === 'activity' || search.create === 'reservation' ? search.create : '',
          closeLabel: ui.closePanel,
        }}
      />
      {help}
    </div>
  );
}
