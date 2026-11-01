import Link from 'next/link';
import { getHome, requireUser } from '@/lib/data';
import { i18n } from '@/lib/i18n/server';
import { homeDate } from '@/lib/timezones';
import { calendarMessages } from '@/features/calendar/messages';

export async function UpcomingEvent({ homeId }: { homeId: string }) {
  const [home, { db }, { locale, t }] = await Promise.all([getHome(homeId), requireUser(), i18n()]);
  const now = new Date().toISOString();
  const [reservations, activities] = await Promise.all([
    db
      .from('reservations')
      .select('id,title,resource_name,starts_at')
      .eq('home_id', homeId)
      .is('cancelled_at', null)
      .gte('starts_at', now)
      .order('starts_at')
      .order('id')
      .limit(1),
    db
      .from('activities')
      .select('id,title,starts_at')
      .eq('home_id', homeId)
      .is('cancelled_at', null)
      .gte('starts_at', now)
      .order('starts_at')
      .order('id')
      .limit(1),
  ]);
  const failed = reservations.error || activities.error;
  const event = [
    ...(reservations.data ?? []).map((r) => ({
      id: r.id,
      title: r.title ? `${r.resource_name} · ${r.title}` : r.resource_name,
      starts_at: r.starts_at,
    })),
    ...(activities.data ?? []),
  ].sort(
    (a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.id.localeCompare(b.id),
  )[0];
  const day = event ? homeDate(home.timezone, event.starts_at) : '';
  return (
    <section className="panel">
      <h2>{t.nextEvent}</h2>
      {failed ? (
        <p role="alert">{calendarMessages(locale).error}</p>
      ) : event ? (
        <>
          <p>
            <strong>{event.title}</strong>
          </p>
          <p>
            <time dateTime={event.starts_at}>
              {new Intl.DateTimeFormat(locale, {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: home.timezone,
              }).format(new Date(event.starts_at))}
            </time>
          </p>
        </>
      ) : (
        <p>{t.noUpcomingEvents}</p>
      )}
      <Link
        className="text-link"
        href={`/homes/${homeId}/calendar${event && !failed ? `?month=${day.slice(0, 7)}&day=${day}` : ''}`}
      >
        {t.viewCalendar}
      </Link>
    </section>
  );
}
