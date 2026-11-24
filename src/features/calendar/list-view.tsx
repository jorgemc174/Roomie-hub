import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import type { Locale } from '@/lib/i18n/dictionaries';
import { ActivityCard, ReservationCard } from './event-card';
import { calendarMessages } from './messages';
import { calendarListHref, type CalendarKind, type CalendarListView } from './queries';
import type {
  ActivityView,
  ParticipantView,
  Person,
  ReservationView,
  ResourceOption,
} from './models';

// Upcoming and history lists of the records the calendar manages, paginated by kind.
export function CalendarList({
  homeId,
  locale,
  timezone,
  userId,
  now,
  view,
  kind,
  resource,
  item,
  page,
  hasMore,
  activities,
  participants,
  reservations,
  resources,
  people,
}: {
  homeId: string;
  locale: Locale;
  timezone: string;
  userId: string;
  now: string;
  view: CalendarListView;
  kind: CalendarKind;
  resource: string;
  item?: string;
  page: number;
  hasMore: boolean;
  activities: ActivityView[];
  participants: ParticipantView[];
  reservations: ReservationView[];
  resources: ResourceOption[];
  people: Person[];
}) {
  const t = calendarMessages(locale),
    base = `/homes/${homeId}/calendar`,
    shared = { homeId, locale, timezone, userId, now };
  const href = (changes: { kind?: CalendarKind; page?: number }) =>
    calendarListHref(base, { view, kind, resource, page, ...changes });
  const empty = kind === 'activities' ? !activities.length : !reservations.length;
  return (
    <section className="stack" aria-labelledby="calendar-list-heading">
      <div className="grid gap-3">
        <h2 id="calendar-list-heading">
          {view === 'history' ? t.history : t.upcoming} ·{' '}
          {kind === 'activities' ? t.activities : t.reservations}
        </h2>
        <p>{view === 'history' ? t.historyHelp : t.upcomingHelp}</p>
        <nav className="filter-links" aria-label={t.eventType}>
          {(['activities', 'reservations'] as const).map((key) => (
            <Link
              key={key}
              href={href({ kind: key, page: 0 })}
              aria-current={kind === key && !item ? 'page' : undefined}
            >
              {t[key]}
            </Link>
          ))}
        </nav>
        {kind === 'reservations' && !item && resources.length > 0 && (
          <form className="form" method="get" action={base}>
            <input type="hidden" name="view" value={view} />
            <input type="hidden" name="kind" value="reservations" />
            <div className="form-row">
              <label>
                {t.resource}
                <select name="resource" defaultValue={resource}>
                  <option value="">{t.allResources}</option>
                  {resources.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                      {x.active ? '' : ` · ${t.inactive}`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button className="button secondary">{t.filter}</button>
          </form>
        )}
        {item && (
          <Link className="text-link" href={calendarListHref(base, { view: 'history', kind })}>
            {t.allHistory} →
          </Link>
        )}
      </div>
      {empty && <EmptyState title={kind === 'activities' ? t.noActivities : t.noReservations} />}
      <ul className="calendar-agenda">
        {kind === 'activities'
          ? activities.map((a) => (
              <ActivityCard
                key={a.id}
                {...shared}
                activity={a}
                participants={participants}
                people={people}
              />
            ))
          : reservations.map((b) => (
              <ReservationCard
                key={b.id}
                {...shared}
                reservation={b}
                resources={resources}
                people={people}
              />
            ))}
      </ul>
      {(page > 0 || hasMore) && (
        <nav className="row wrap" aria-label={t.pages}>
          {page > 0 && (
            <Link className="button secondary" href={href({ page: page - 1 })}>
              {t.previousPage}
            </Link>
          )}
          {hasMore && (
            <Link className="button secondary" href={href({ page: page + 1 })}>
              {t.nextPage}
            </Link>
          )}
        </nav>
      )}
    </section>
  );
}
