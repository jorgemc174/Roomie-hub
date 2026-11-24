import { validDate } from '@/features/organization/logic';
import { calendarItem, calendarPageIndex } from './queries';

type Search = Record<string, string | string[] | undefined>;

// Former Actividades and Reservas screens are no longer destinations. Their bookmarks,
// notifications and shared links open the equivalent calendar state instead.
function calendarHref(homeId: string, params: Record<string, string | undefined>, hash = '') {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const suffix = query.toString();
  return `/homes/${homeId}/calendar${suffix ? `?${suffix}` : ''}${hash ? `#${hash}` : ''}`;
}
const page = (search: Search) => {
  const value = calendarPageIndex(search.page);
  return value ? String(value) : undefined;
};

export function legacyActivitiesHref(homeId: string, search: Search) {
  const item = calendarItem(search.item);
  if (item) return calendarHref(homeId, { item }, `activity-${item}`);
  if (search.create === 'activity')
    return calendarHref(homeId, { create: 'activity' }, 'create-activity');
  return calendarHref(homeId, {
    view: search.view === 'history' ? 'history' : 'upcoming',
    kind: 'activities',
    page: page(search),
  });
}

export function legacyReservationsHref(homeId: string, search: Search) {
  const item = calendarItem(search.item),
    resource = calendarItem(search.resource);
  if (item) return calendarHref(homeId, { item }, `reservation-${item}`);
  if (search.create === 'reservation')
    return calendarHref(homeId, { create: 'reservation', resource }, 'create-reservation');
  if (search.view === 'day') {
    // The former day view listed one day's reservations; the agenda shows the same day.
    const day = typeof search.day === 'string' && validDate(search.day) ? search.day : undefined;
    return calendarHref(homeId, {
      month: day?.slice(0, 7),
      day,
      types: 'reservations',
      resource,
    });
  }
  return calendarHref(homeId, {
    view: search.view === 'history' ? 'history' : 'upcoming',
    kind: 'reservations',
    resource,
    page: page(search),
  });
}
