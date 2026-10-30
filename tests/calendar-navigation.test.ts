import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readCalendarNavigation,
  calendarNavigationHref,
} from '../src/features/calendar/navigation';
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
