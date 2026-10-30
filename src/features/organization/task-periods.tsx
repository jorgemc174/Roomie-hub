import type { Locale } from '@/lib/i18n/dictionaries';
import { addDays } from './logic';

// Presentation only: retain every occurrence; groups and their items keep first-seen order.
export function groupTaskPeriods<T extends { period_start: string; period_end: string }>(
  rows: T[],
) {
  const groups = new Map<string, { start: string; end: string; items: T[] }>();
  for (const row of rows) {
    const key = `${row.period_start}/${row.period_end}`;
    const group = groups.get(key) ?? { start: row.period_start, end: row.period_end, items: [] };
    group.items.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function TaskPeriodDates({
  start,
  end,
  locale,
}: {
  start: string;
  end: string;
  locale: Locale;
}) {
  const last = addDays(end, -1);
  const format = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${value}T12:00:00Z`));
  return (
    <>
      <time dateTime={start}>{format(start)}</time>
      {last !== start && (
        <>
          {' '}
          – <time dateTime={last}>{format(last)}</time>
        </>
      )}
    </>
  );
}

export function TaskPeriodHeading(props: { start: string; end: string; locale: Locale }) {
  return (
    <h2 className="task-period-heading">
      <TaskPeriodDates {...props} />
    </h2>
  );
}
