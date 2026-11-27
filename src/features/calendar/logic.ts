import { homeDate } from '@/lib/timezones';
import { validDate, addDays } from '@/features/organization/logic';
import type { Activity, ActivityMember, Reservation, CalendarEvent, EventSource } from './models';
import type { ChoreInstance } from '@/features/organization/models';
import type { Recurring, Occurrence } from '@/features/expenses/models';
export function localInput(instant: string, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
}
export function validLocalInput(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value) &&
    validDate(value.slice(0, 10)) &&
    Number(value.slice(11, 13)) < 24 &&
    Number(value.slice(14, 16)) < 60 &&
    (!value.slice(17) || Number(value.slice(17)) < 60)
  );
}
export function formatInstant(instant: string, zone: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(instant));
}
export const eventSources: EventSource[] = ['tasks', 'reservations', 'activities', 'expenses'];
// Activities and reservations are managed inside the calendar: their links open the
// start day and keep the record ID, also when the record is beyond a history page.
export function calendarItemHref(
  homeId: string,
  kind: 'activity' | 'reservation',
  id: string,
  startsAt: string,
  zone: string,
) {
  const day = homeDate(zone, startsAt);
  return `/homes/${homeId}/calendar?month=${day.slice(0, 7)}&day=${day}&item=${id}#${kind}-${id}`;
}
// Tasks are listed in Convivencia; the period keeps each occurrence reachable.
export function calendarTaskHref(homeId: string, periodStart: string, id: string) {
  return `/homes/${homeId}/community?tab=tasks&view=all&from=${periodStart}#task-${id}`;
}
// Local defaults for a new record on the selected day. Days before today cannot be used:
// activities never start in the past and reservations allow only five minutes.
export function dayDefaults(day: string, today: string, nowLocal: string) {
  if (!validDate(day) || day < today) return null;
  const nextHour = Number(nowLocal.slice(11, 13)) + 1;
  const hour = (preferred: number) => (day > today ? preferred : Math.max(preferred, nextHour));
  const time = (h: number, last = '23:59:00') =>
    h > 23 ? last : `${String(h).padStart(2, '0')}:00:00`;
  const reservation = hour(18);
  return {
    activity: time(hour(21)),
    reservationStart: time(reservation),
    reservationEnd: time(reservation + 1, '23:59:59'),
  };
}
export function normalizeCalendar(
  input: {
    homeId: string;
    tasks: ChoreInstance[];
    reservations: Reservation[];
    activities: Activity[];
    members: ActivityMember[];
    recurring: Recurring[];
    occurrences: Occurrence[];
    timezone?: string;
    /** Names inside this home (active and former members) for expense templates. */
    names?: Record<string, string>;
  },
  now: string,
): CalendarEvent[] {
  const base = `/homes/${input.homeId}`,
    zone = input.timezone ?? 'UTC',
    events: CalendarEvent[] = [];
  // Expense templates only keep user IDs: payer first, then participants, without repeats.
  const involved = (template: Recurring['template']) => {
    const people = [...new Set([template.payer, ...template.participants.map((p) => p.user_id)])];
    return {
      people,
      names: people.flatMap((id) => (input.names?.[id] ? [input.names[id]] : [])),
    };
  };
  for (const t of input.tasks) {
    if (t.cancelled_at) continue;
    events.push({
      id: `task:${t.id}`,
      sourceType: 'tasks',
      sourceId: t.id,
      title: t.task_name,
      startsAt: t.deadline_at ?? t.period_start,
      endsAt: null,
      allDay: !t.deadline_at,
      status: t.completed_at
        ? 'completed'
        : t.deadline_at && Date.parse(t.deadline_at) < Date.parse(now)
          ? 'overdue'
          : 'pending',
      people: [t.assignee_id],
      names: [t.assignee_name],
      href: calendarTaskHref(input.homeId, t.period_start, t.id),
    });
  }
  for (const r of input.reservations) {
    if (r.cancelled_at) continue;
    events.push({
      id: `reservation:${r.id}`,
      sourceType: 'reservations',
      sourceId: r.id,
      title: r.title ? `${r.resource_name} · ${r.title}` : r.resource_name,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      allDay: false,
      status: 'scheduled',
      people: [r.responsible_id],
      names: [r.responsible_name],
      resourceId: r.resource_id,
      href: calendarItemHref(input.homeId, 'reservation', r.id, r.starts_at, zone),
    });
  }
  for (const a of input.activities) {
    if (a.cancelled_at) continue;
    const members = input.members.filter((m) => m.activity_id === a.id && m.attending);
    events.push({
      id: `activity:${a.id}`,
      sourceType: 'activities',
      sourceId: a.id,
      title: a.title,
      startsAt: a.starts_at,
      endsAt: a.ends_at,
      allDay: false,
      status: 'scheduled',
      people: members.map((m) => m.user_id),
      names: members.map((m) => m.user_name),
      location: a.location,
      href: calendarItemHref(input.homeId, 'activity', a.id, a.starts_at, zone),
    });
  }
  for (const r of input.recurring) {
    if (!r.active) continue;
    events.push({
      id: `recurring:${r.id}:${r.next_date}`,
      sourceType: 'expenses',
      sourceId: r.id,
      title: r.template.title,
      startsAt: r.next_date,
      endsAt: null,
      allDay: true,
      status: 'scheduled',
      ...involved(r.template),
      href: `${base}/expenses?tab=recurring#recurring-${r.id}`,
    });
  }
  for (const r of input.occurrences) {
    if (r.status !== 'pending') continue;
    events.push({
      id: `pending:${r.id}`,
      sourceType: 'expenses',
      sourceId: r.id,
      title: r.template.title,
      startsAt: r.period_date,
      endsAt: null,
      allDay: true,
      status: 'pending',
      ...involved(r.template),
      href: `${base}/expenses?tab=recurring#occurrence-${r.id}`,
    });
  }
  return events.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
}
export function eventOnDay(event: CalendarEvent, day: string, zone: string): boolean {
  if (event.allDay)
    return event.startsAt <= day && (event.endsAt ? day < event.endsAt : event.startsAt === day);
  const first = homeDate(zone, event.startsAt),
    last = event.endsAt ? homeDate(zone, new Date(Date.parse(event.endsAt) - 1)) : first;
  return first <= day && day <= last;
}
export function filterEvents(
  events: CalendarEvent[],
  types: EventSource[],
  mine: boolean,
  userId: string,
  resource = '',
) {
  // The resource filter narrows reservations only; other sources keep their type filter.
  return events.filter(
    (e) =>
      types.includes(e.sourceType) &&
      (!mine || e.people.includes(userId)) &&
      (!resource || e.sourceType !== 'reservations' || e.resourceId === resource),
  );
}
export function monthDays(month: string, weekStart: number) {
  const first = `${month}-01`;
  if (!validDate(first)) throw new Error('invalid_month');
  const offset = (new Date(`${first}T12:00:00Z`).getUTCDay() - weekStart + 7) % 7;
  return Array.from({ length: 42 }, (_, i) => addDays(first, i - offset));
}
export function adjacentMonth(month: string, delta: number) {
  const d = new Date(`${month}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 7);
}
