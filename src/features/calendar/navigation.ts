import { validDate } from '@/features/organization/logic';
import { eventSources } from './logic';
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function readCalendarNavigation(
  search: Pick<URLSearchParams, 'get' | 'has'>,
  month: string,
  fallbackDay: string,
) {
  const requestedDay = search.get('day') ?? '';
  const types = search.has('types')
    ? eventSources.filter((type) => (search.get('types') ?? '').split(',').includes(type))
    : [...eventSources];
  const resource = search.get('resource') ?? '';
  return {
    day: validDate(requestedDay) && requestedDay.startsWith(month) ? requestedDay : fallbackDay,
    types,
    mine: search.get('mine') === '1',
    // Unknown resource IDs are ignored rather than hiding every reservation.
    resource: uuid.test(resource) ? resource : '',
  };
}
export type CalendarChanges = Partial<
  Record<
    'month' | 'day' | 'types' | 'mine' | 'resource' | 'item' | 'create' | 'view' | 'kind' | 'page',
    string | null
  >
>;
export function calendarNavigationHref(
  base: string,
  search: { toString(): string },
  changes: CalendarChanges,
) {
  const query = new URLSearchParams(search.toString());
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) query.delete(key);
    else if (value !== undefined) query.set(key, value);
  }
  const suffix = query.toString();
  return `${base}${suffix ? `?${suffix}` : ''}`;
}
