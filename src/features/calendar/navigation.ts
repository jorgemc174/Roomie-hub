import { validDate } from '@/features/organization/logic';
import { eventSources } from './logic';
export function readCalendarNavigation(
  search: Pick<URLSearchParams, 'get' | 'has'>,
  month: string,
  fallbackDay: string,
) {
  const requestedDay = search.get('day') ?? '';
  const types = search.has('types')
    ? eventSources.filter((type) => (search.get('types') ?? '').split(',').includes(type))
    : [...eventSources];
  return {
    day: validDate(requestedDay) && requestedDay.startsWith(month) ? requestedDay : fallbackDay,
    types,
    mine: search.get('mine') === '1',
  };
}
export function calendarNavigationHref(
  base: string,
  search: { toString(): string },
  changes: {
    month?: string | null;
    day?: string | null;
    types?: string | null;
    mine?: string | null;
  },
) {
  const query = new URLSearchParams(search.toString());
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) query.delete(key);
    else if (value !== undefined) query.set(key, value);
  }
  const suffix = query.toString();
  return `${base}${suffix ? `?${suffix}` : ''}`;
}
