import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readCalendarNavigation,
  calendarNavigationHref,
} from '../src/features/calendar/navigation';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { legacyActivitiesHref, legacyReservationsHref } from '../src/features/calendar/legacy';
import { calendarListHref } from '../src/features/calendar/queries';
import {
  calendarItemHref,
  calendarTaskHref,
  dayDefaults,
  filterEvents,
  normalizeCalendar,
} from '../src/features/calendar/logic';
import type { Reservation } from '../src/features/calendar/models';

test('a calendar deep link restores its selected day and explicit filters', () => {
  const state = readCalendarNavigation(
    new URLSearchParams('day=2026-10-15&types=tasks,reservations&mine=1'),
    '2026-10',
    '2026-10-29',
  );
  assert.equal(state.day, '2026-10-15');
  assert.equal(state.mine, true);
  assert.deepEqual(state.types, ['tasks', 'reservations']);
});
test('calendar links retain filters when changing month and discard a day from another month', () => {
  const href = calendarNavigationHref(
    '/homes/test/calendar',
    new URLSearchParams('month=2026-10&day=2026-10-15&types=tasks&mine=1'),
    { month: '2026-11', day: null },
  );
  const query = new URL(href, 'https://local.test').searchParams;
  assert.equal(query.get('month'), '2026-11');
  assert.equal(query.has('day'), false);
  assert.equal(query.get('types'), 'tasks');
  assert.equal(query.get('mine'), '1');
});
test('invalid dates and unknown types are never treated as valid calendar selections', () => {
  const state = readCalendarNavigation(
    new URLSearchParams('day=2026-10-99&types=unknown,tasks,tasks&mine=0'),
    '2026-10',
    '2026-10-29',
  );
  assert.equal(state.day, '2026-10-29');
  assert.deepEqual(state.types, ['tasks']);
  assert.equal(state.mine, false);
  assert.deepEqual(
    readCalendarNavigation(new URLSearchParams('types='), '2026-10', '2026-10-29').types,
    [],
  );
  assert.equal(
    readCalendarNavigation(new URLSearchParams(), '2026-10', '2026-10-29').types.length,
    4,
  );
});
const item = '0b6c7d1e-1111-4111-8111-111111111111',
  resource = '1c6c7d1e-2222-4222-8222-222222222222';
const parts = (href: string) => {
  const url = new URL(href, 'https://local.test');
  return { path: url.pathname, query: Object.fromEntries(url.searchParams), hash: url.hash };
};

test('calendar state keeps a valid resource filter and drops transient focus on change', () => {
  assert.equal(
    readCalendarNavigation(new URLSearchParams(`resource=${resource}`), '2026-10', '2026-10-01')
      .resource,
    resource,
  );
  assert.equal(
    readCalendarNavigation(new URLSearchParams('resource=washer'), '2026-10', '2026-10-01')
      .resource,
    '',
  );
  const href = calendarNavigationHref(
    '/homes/test/calendar',
    new URLSearchParams(`item=${item}&create=activity&types=reservations&resource=${resource}`),
    { item: null, create: null, month: '2026-10', day: '2026-10-15' },
  );
  assert.deepEqual(parts(href).query, {
    types: 'reservations',
    resource,
    month: '2026-10',
    day: '2026-10-15',
  });
});

test('former Actividades links open the same state in the calendar', () => {
  const home = '/homes/h/calendar';
  assert.deepEqual(parts(legacyActivitiesHref('h', { view: 'all', item })), {
    path: home,
    query: { item },
    hash: `#activity-${item}`,
  });
  assert.deepEqual(parts(legacyActivitiesHref('h', {})), {
    path: home,
    query: { view: 'upcoming', kind: 'activities' },
    hash: '',
  });
  assert.deepEqual(parts(legacyActivitiesHref('h', { view: 'history', page: '2' })).query, {
    view: 'history',
    kind: 'activities',
    page: '2',
  });
  assert.deepEqual(parts(legacyActivitiesHref('h', { create: 'activity' })), {
    path: home,
    query: { create: 'activity' },
    hash: '#create-activity',
  });
  // Invalid values never become filters, and nothing points back to a retired screen.
  assert.deepEqual(parts(legacyActivitiesHref('h', { item: 'x', page: '-1', view: 'all' })).query, {
    view: 'upcoming',
    kind: 'activities',
  });
});

test('former Reservas links keep record, day, resource, history and page', () => {
  assert.deepEqual(parts(legacyReservationsHref('h', { view: 'all', item })), {
    path: '/homes/h/calendar',
    query: { item },
    hash: `#reservation-${item}`,
  });
  assert.deepEqual(
    parts(legacyReservationsHref('h', { view: 'day', day: '2026-11-03', resource })).query,
    { month: '2026-11', day: '2026-11-03', types: 'reservations', resource },
  );
  assert.deepEqual(parts(legacyReservationsHref('h', { view: 'day', day: '2026-02-30' })).query, {
    types: 'reservations',
  });
  assert.deepEqual(
    parts(legacyReservationsHref('h', { view: 'history', resource, page: '1' })).query,
    { view: 'history', kind: 'reservations', resource, page: '1' },
  );
  assert.deepEqual(parts(legacyReservationsHref('h', { resource: 'washer' })).query, {
    view: 'upcoming',
    kind: 'reservations',
  });
  assert.deepEqual(parts(legacyReservationsHref('h', { create: 'reservation', resource })), {
    path: '/homes/h/calendar',
    query: { create: 'reservation', resource },
    hash: '#create-reservation',
  });
  for (const href of [
    legacyReservationsHref('h', { view: ['day'], day: ['2026-11-03'] }),
    legacyActivitiesHref('h', { item: [item] }),
  ])
    assert.equal(parts(href).path, '/homes/h/calendar');
});

test('former routes check the home before redirecting with their query', async () => {
  for (const [route, expected] of [
    ['community/activities', `/homes/h/calendar?item=${item}#activity-${item}`],
    ['organization/reservations', `/homes/h/calendar?item=${item}#reservation-${item}`],
  ] as const) {
    const calls: string[] = [];
    const { outputText } = ts.transpileModule(
      await readFile(`src/app/(workspace)/homes/[homeId]/${route}/page.tsx`, 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
    );
    const exports: { default?: (props: object) => Promise<unknown> } = {};
    vm.runInNewContext(outputText, {
      exports,
      URLSearchParams,
      require: (name: string) => {
        if (name === 'next/navigation')
          return {
            redirect: (href: string) => {
              calls.push(`redirect ${href}`);
              throw new Error('NEXT_REDIRECT');
            },
          };
        if (name === '@/lib/data')
          return { getHome: async (id: string) => calls.push(`home ${id}`) };
        if (name === '@/features/calendar/legacy')
          return { legacyActivitiesHref, legacyReservationsHref };
        throw new Error(`Unexpected dependency ${name}`);
      },
    });
    await assert.rejects(
      exports.default!({
        params: Promise.resolve({ homeId: 'h' }),
        searchParams: Promise.resolve({ view: 'all', item }),
      }),
      /NEXT_REDIRECT/,
    );
    assert.deepEqual(calls, ['home h', `redirect ${expected}`]);
  }
});

test('calendar list links keep view, kind, a reservation resource and page only', () => {
  assert.equal(
    calendarListHref('/c', { view: 'history', kind: 'reservations', resource, page: 3 }),
    `/c?view=history&kind=reservations&resource=${resource}&page=3`,
  );
  assert.equal(
    calendarListHref('/c', { view: 'upcoming', kind: 'activities', resource, page: 0 }),
    '/c?view=upcoming&kind=activities',
  );
});

test('creation defaults follow the selected day and stay ahead of the home clock', () => {
  assert.deepEqual(dayDefaults('2026-11-26', '2026-11-24', '2026-11-24T11:00:00'), {
    activity: '21:00:00',
    reservationStart: '18:00:00',
    reservationEnd: '19:00:00',
  });
  assert.deepEqual(dayDefaults('2026-11-24', '2026-11-24', '2026-11-24T11:00:00'), {
    activity: '21:00:00',
    reservationStart: '18:00:00',
    reservationEnd: '19:00:00',
  });
  assert.deepEqual(dayDefaults('2026-11-24', '2026-11-24', '2026-11-24T20:30:00'), {
    activity: '21:00:00',
    reservationStart: '21:00:00',
    reservationEnd: '22:00:00',
  });
  assert.deepEqual(dayDefaults('2026-11-24', '2026-11-24', '2026-11-24T22:10:00'), {
    activity: '23:00:00',
    reservationStart: '23:00:00',
    reservationEnd: '23:59:59',
  });
  assert.deepEqual(dayDefaults('2026-11-24', '2026-11-24', '2026-11-24T23:10:00'), {
    activity: '23:59:00',
    reservationStart: '23:59:00',
    reservationEnd: '23:59:59',
  });
  assert.equal(dayDefaults('2026-11-23', '2026-11-24', '2026-11-24T11:00:00'), null);
  assert.equal(dayDefaults('2026-02-30', '2026-01-01', '2026-01-01T11:00:00'), null);
});

test('event links use the home day, keep the record ID and canonical task tab', () => {
  // 23:30 UTC is already the next day in Madrid.
  assert.equal(
    calendarItemHref('h', 'reservation', item, '2026-10-31T23:30:00Z', 'Europe/Madrid'),
    `/homes/h/calendar?month=2026-11&day=2026-11-01&item=${item}#reservation-${item}`,
  );
  assert.equal(
    calendarTaskHref('h', '2026-11-02', 't1'),
    '/homes/h/community?tab=tasks&view=all&from=2026-11-02#task-t1',
  );
  const reservation = (id: string, resource_id: string) =>
    ({
      id,
      resource_id,
      resource_name: id,
      title: '',
      responsible_id: 'u1',
      responsible_name: 'Ana',
      starts_at: '2026-11-02T10:00:00Z',
      ends_at: '2026-11-02T11:00:00Z',
      cancelled_at: null,
    }) as Reservation;
  const events = normalizeCalendar(
    {
      homeId: 'h',
      tasks: [],
      reservations: [reservation('a', resource), reservation('b', 'other')],
      activities: [],
      members: [],
      recurring: [],
      occurrences: [],
      timezone: 'Europe/Madrid',
    },
    '2026-11-01T00:00:00Z',
  );
  assert.deepEqual(
    filterEvents(events, ['reservations'], false, 'u1', resource).map((e) => e.sourceId),
    ['a'],
  );
  assert.equal(filterEvents(events, ['reservations'], false, 'u1').length, 2);
  assert.ok(events.every((e) => !e.href.includes('/organization/reservations')));
});
