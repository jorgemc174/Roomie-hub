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

// A period ends exclusively in the home's local calendar. This is a presentation
// backlog, independent of deadline-based penalties or the selected query date.
export function splitTaskPeriods<
  T extends {
    period_start: string;
    period_end: string;
    completed_at: string | null;
    cancelled_at: string | null;
  },
>(rows: T[], today: string) {
  const backlog = rows.filter(
    (row) => row.period_end <= today && !row.completed_at && !row.cancelled_at,
  );
  const backlogRows = new Set(backlog);
  const priority = (start: string, end: string) =>
    start <= today && end > today ? 0 : start > today ? 1 : 2;
  const visible = groupTaskPeriods(rows.filter((row) => !backlogRows.has(row))).sort(
    (a, b) =>
      priority(a.start, a.end) - priority(b.start, b.end) ||
      a.start.localeCompare(b.start) ||
      a.end.localeCompare(b.end),
  );
  return {
    visible,
    backlog: groupTaskPeriods(backlog).sort(
      (a, b) => b.start.localeCompare(a.start) || b.end.localeCompare(a.end),
    ),
    backlogCount: backlog.length,
  };
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
