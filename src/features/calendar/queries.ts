import { readRows } from '@/features/organization/read-rows';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';

export async function calendarRows<Row>(query: Parameters<typeof readRows<Row>>[0]) {
  const r = await readRows(query);
  if (r.error) throw r.error;
  return r.data;
}

type CalendarDB = Pick<SupabaseClient<Database>, 'from' | 'rpc'>;
const pageSize = 50;

export function calendarPageIndex(value: string | string[] | undefined) {
  return typeof value === 'string' && /^\d{1,6}$/.test(value) ? Number(value) : 0;
}

export function calendarItem(value: string | string[] | undefined) {
  return typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined;
}

export function calendarPageHref(
  base: string,
  search: Record<string, string | string[] | undefined>,
  page: number,
) {
  const params = new URLSearchParams();
  for (const key of ['view', 'day', 'resource'])
    if (typeof search[key] === 'string') params.set(key, search[key]);
  params.set('page', String(page));
  return `${base}?${params}`;
}

async function calendarPage<Row>(query: Parameters<typeof readRows<Row>>[0], page: number) {
  // One extra row determines whether another page exists without counting all history.
  const r = await query.range(page * pageSize, page * pageSize + pageSize);
  if (r.error) throw r.error;
  return { rows: (r.data ?? []).slice(0, pageSize), hasMore: (r.data?.length ?? 0) > pageSize };
}

export async function readReservationPage(
  db: CalendarDB,
  homeId: string,
  options: {
    view: string;
    day: string;
    resource: string;
    now: string;
    page: number;
    item?: string;
  },
) {
  const { view, day, resource, now, page, item } = options;
  // Unknown resource filters used to yield an empty list rather than a UUID cast error.
  if (resource && !calendarItem(resource)) return { rows: [], hasMore: false };
  // SQL converts day boundaries in the home's IANA zone, including DST transitions.
  let query =
    view === 'day'
      ? db.rpc('reservations_on_day', { target: homeId, on_day: day }).select('*')
      : db.from('reservations').select('*');
  query = query.eq('home_id', homeId);
  if (resource) query = query.eq('resource_id', resource);
  if (item) query = query.eq('id', item);
  if (view === 'history') query = query.or(`cancelled_at.not.is.null,ends_at.lte.${now}`);
  else if (view !== 'all') {
    query = query.is('cancelled_at', null);
    if (view !== 'day') query = query.gt('ends_at', now);
  }
  return calendarPage(query.order('starts_at').order('id'), item ? 0 : page);
}

export async function readActivityPage(
  db: CalendarDB,
  homeId: string,
  options: { view: string; now: string; page: number; item?: string },
) {
  const { view, now, page, item } = options;
  let query = db.from('activities').select('*').eq('home_id', homeId);
  if (item) query = query.eq('id', item);
  // A missing end makes the start the closing instant; retain exact <= / > boundaries.
  if (view === 'history')
    query = query.or(
      `cancelled_at.not.is.null,ends_at.lte.${now},and(ends_at.is.null,starts_at.lte.${now})`,
    );
  else if (view !== 'all')
    query = query
      .is('cancelled_at', null)
      .or(`ends_at.gt.${now},and(ends_at.is.null,starts_at.gt.${now})`);
  return calendarPage(query.order('starts_at').order('id'), item ? 0 : page);
}

export async function readActivityMembers(db: CalendarDB, homeId: string, ids: string[]) {
  if (!ids.length) return [];
  return calendarRows(
    db
      .from('activity_members')
      .select('*')
      .eq('home_id', homeId)
      .in('activity_id', ids)
      .order('activity_id')
      .order('user_id'),
  );
}
