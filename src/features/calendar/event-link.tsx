import Link from 'next/link';
import type { Locale } from '@/lib/i18n/dictionaries';
import type { CalendarEvent } from './models';
import { calendarMessages } from './messages';
import { formatInstant } from './logic';

// Read-only agenda entry for records owned by another section (tasks and expenses).
export function EventLink({
  event,
  locale,
  timezone,
}: {
  event: CalendarEvent;
  locale: Locale;
  timezone: string;
}) {
  const t = calendarMessages(locale);
  return (
    <li className={`calendar-event kind-${event.sourceType}`}>
      <Link href={event.href}>
        <div>
          <span className={`badge kind-${event.sourceType}`}>{t[event.sourceType]}</span>{' '}
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
  );
}
