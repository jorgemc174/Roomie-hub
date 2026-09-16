import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { organizationDatabase } from './helpers/database';
import {
  localInput,
  validLocalInput,
  eventOnDay,
  normalizeCalendar,
  filterEvents,
  monthDays,
} from '../src/features/calendar/logic';
import { calendarMessages } from '../src/features/calendar/messages';
import type {
  CalendarEvent,
  Reservation,
  Activity,
  ActivityMember,
} from '../src/features/calendar/models';
import type { ChoreInstance } from '../src/features/organization/models';
import type { Recurring, Occurrence } from '../src/features/expenses/models';
test('local date/time is independent of browser zone; midnight, DST, UTC and Canary', () => {
  assert.equal(localInput('2026-09-15T22:30:00Z', 'Europe/Madrid'), '2026-09-16T00:30:00');
  assert.equal(localInput('2026-09-15T22:30:00Z', 'UTC'), '2026-09-15T22:30:00');
  assert.equal(localInput('2026-09-15T23:30:00Z', 'Atlantic/Canary'), '2026-09-16T00:30:00');
  assert.equal(localInput('2026-03-29T01:30:00Z', 'Europe/Madrid'), '2026-03-29T03:30:00');
  assert.equal(localInput('2026-09-15T22:30:00Z', 'Asia/Tokyo'), '2026-09-16T07:30:00');
  for (const bad of [
    '2026-02-30T10:00',
    '2026-09-15T24:01',
    '2026-09-15T10:60',
    '2026-09-15T10:00Z',
  ])
    assert.equal(validLocalInput(bad), false);
  assert.equal(validLocalInput('2026-09-15T10:00'), true);
  assert.equal(monthDays('2026-09', 1).length, 42);
  assert.equal(monthDays('2026-09', 1)[0], '2026-08-31');
  assert.deepEqual(
    Object.keys(calendarMessages('es')).sort(),
    Object.keys(calendarMessages('en')).sort(),
  );
});
test('four calendar sources, pending recurrences, type/personal filters and exclusive midnight', () => {
  const task = {
    id: 't',
    task_name: 'Kitchen',
    period_start: '2026-09-16',
    deadline_at: '2026-09-15T22:30:00Z',
    assignee_id: 'a',
    assignee_name: 'Ana',
    completed_at: null,
    cancelled_at: null,
  } as ChoreInstance;
  const reservation = {
    id: 'r',
    resource_name: 'Washer',
    title: '',
    starts_at: '2026-09-16T20:00:00Z',
    ends_at: '2026-09-16T22:00:00Z',
    responsible_id: 'b',
    responsible_name: 'Bob',
    cancelled_at: null,
  } as Reservation;
  const activity = {
    id: 'a',
    title: 'Dinner',
    starts_at: '2026-09-16T19:00:00Z',
    ends_at: null,
    location: 'Home',
    cancelled_at: null,
  } as Activity;
  const member = {
    activity_id: 'a',
    user_id: 'a',
    user_name: 'Ana',
    attending: true,
  } as ActivityMember;
  const template = { title: 'Rent', payer: 'a', participants: [{ user_id: 'b', weight: '1' }] };
  const recurring = { id: 'f', active: true, next_date: '2026-09-16', template } as Recurring;
  const pending = {
    id: 'p',
    status: 'pending',
    period_date: '2026-09-16',
    template: { ...template, title: 'Electricity' },
  } as Occurrence;
  const events = normalizeCalendar(
    {
      homeId: 'h',
      tasks: [task, { ...task, id: 'cancelled', cancelled_at: '2026-09-15T12:00Z' }],
      reservations: [reservation],
      activities: [activity],
      members: [member],
      recurring: [recurring],
      occurrences: [pending],
    },
    '2026-09-16T10:00:00Z',
  );
  assert.equal(events.length, 5);
  assert.equal(events.find((e) => e.sourceType === 'tasks')?.status, 'overdue');
  assert.equal(filterEvents(events, ['activities'], true, 'a').length, 1);
  assert.equal(filterEvents(events, ['activities'], true, 'b').length, 0);
  assert.equal(filterEvents(events, [], false, 'a').length, 0);
  assert.equal(filterEvents(events, ['expenses'], true, 'b').length, 2);
  const r = events.find((e) => e.sourceType === 'reservations')!;
  assert.equal(eventOnDay(r, '2026-09-16', 'Europe/Madrid'), true);
  assert.equal(eventOnDay(r, '2026-09-17', 'Europe/Madrid'), false);
  assert.equal(
    eventOnDay(
      events.find((e) => e.sourceType === 'tasks')!,
      '2026-09-16',
      'Europe/Madrid',
    ),
    true,
  );
  const allDay = { ...r, startsAt: '2026-09-16', endsAt: null, allDay: true } as CalendarEvent;
  assert.equal(eventOnDay(allDay, '2026-09-16', 'America/Los_Angeles'), true);
});
test('PostgreSQL resources, reservations, activities, RLS and lifecycle', async (t) => {
  const { db, as, users, home, scalar } = await organizationDatabase();
  const [a, b, , out] = users;
  const resource = (
    h: string,
    id: string = randomUUID(),
    name = 'Lavadora',
    v = 0,
    active = true,
  ) =>
    scalar<string>('select public.save_resource($1,$2,$3,$4,$5,$6) v', [
      h,
      id,
      v,
      name,
      '',
      active,
    ]);
  const reserve = (
    h: string,
    r: string,
    s: string,
    e: string,
    id: string = randomUUID(),
    v = 0,
    person = a,
    zone = 'UTC',
  ) =>
    scalar<string>('select public.save_reservation($1,$2,$3,$4,$5,$6,$7,$8,$9) v', [
      h,
      id,
      v,
      r,
      person,
      'Booking',
      s,
      e,
      zone,
    ]);
  const activity = (
    h: string,
    id: string = randomUUID(),
    v = 0,
    title = 'Cena',
    s = '2090-09-16T21:00',
    e: string | null = null,
    zone = 'UTC',
  ) =>
    scalar<string>('select public.save_activity($1,$2,$3,$4,$5,$6,$7,$8,$9) v', [
      h,
      id,
      v,
      title,
      'Description',
      'En casa',
      s,
      e,
      zone,
    ]);
  const fixture = async () => {
    const h = await home(3);
    await db.query("select public.update_home_timezone($1,'UTC')", [h]);
    return h;
  };
  try {
    await t.test(
      'resources created explicitly, editable equally, seeds idempotent and deactivation blocks bookings',
      async () => {
        const h = await fixture();
        assert.equal(
          await scalar('select count(*)::int v from public.resources where home_id=$1', [h]),
          0,
        );
        await db.query("select public.initialize_resources($1,'es')", [h]);
        await db.query("select public.initialize_resources($1,'es')", [h]);
        assert.equal(
          await scalar('select count(*)::int v from public.resources where home_id=$1', [h]),
          3,
        );
        const r = await resource(h);
        await as(b);
        await resource(h, r, 'Secadora', 1, false);
        await assert.rejects(
          reserve(h, r, '2090-09-16T10:00', '2090-09-16T11:00'),
          /resource_unavailable/,
        );
        await resource(h, r, 'Secadora', 2, true);
        assert.equal(await scalar('select version v from public.resources where id=$1', [r]), 3);
        await assert.rejects(resource(h, r, 'Old', 1), /stale_version/);
      },
    );
    await t.test(
      'all five overlap cases rejected, touching ends and other resources allowed',
      async () => {
        const h = await fixture(),
          r = await resource(h),
          id = await reserve(h, r, '2090-09-16T10:00', '2090-09-16T11:00');
        for (const [s, e] of [
          ['09:30', '10:30'],
          ['10:00', '11:00'],
          ['10:30', '11:30'],
          ['10:15', '10:45'],
          ['09:00', '12:00'],
        ])
          await assert.rejects(
            reserve(h, r, `2090-09-16T${s}`, `2090-09-16T${e}`),
            /reservation_conflict/,
          );
        await reserve(h, r, '2090-09-16T09:00', '2090-09-16T10:00');
        await reserve(h, r, '2090-09-16T11:00', '2090-09-16T12:00');
        await reserve(h, await resource(h), '2090-09-16T10:00', '2090-09-16T11:00');
        await assert.rejects(reserve(h, r, '2090-09-16T12:00', '2090-09-16T12:00'), /invalid_time/);
        await assert.rejects(reserve(h, r, '2090-09-16T12:00', '2090-09-16T11:00'), /invalid_time/);
        await assert.rejects(reserve(h, r, '2000-09-16T10:00', '2000-09-16T11:00'), /past_start/);
        // Actual exclusion constraint, bypassing the friendly RPC conflict check as DB owner.
        await db.exec('reset role');
        await assert.rejects(
          db.query(
            'insert into public.reservations select gen_random_uuid(),home_id,resource_id,resource_name,title,responsible_id,responsible_name,starts_at,ends_at,created_by,created_by_name,created_at,updated_at,cancelled_at,cancellation_reason,version,create_request from public.reservations where id=$1',
            [id],
          ),
          (e) => (e as { code: string }).code === '23P01',
        );
        await as(a);
      },
    );
    await t.test(
      'two simultaneous submitted creations persist only one; PGlite queues execution',
      async () => {
        const h = await fixture(),
          r = await resource(h);
        const result = await Promise.allSettled([
          reserve(h, r, '2090-09-16T10:00', '2090-09-16T11:00'),
          reserve(h, r, '2090-09-16T10:30', '2090-09-16T11:30'),
        ]);
        assert.equal(result.filter((x) => x.status === 'fulfilled').length, 1);
        assert.equal(
          await scalar('select count(*)::int v from public.reservations where home_id=$1', [h]),
          1,
        );
      },
    );
    await t.test(
      'atomic edit detects conflicts; cancellation frees interval, preserves history and is idempotent',
      async () => {
        const h = await fixture(),
          r = await resource(h),
          id = await reserve(h, r, '2090-09-16T10:00', '2090-09-16T11:00'),
          second = await reserve(h, r, '2090-09-16T12:00', '2090-09-16T13:00');
        await as(b);
        await assert.rejects(
          reserve(h, r, '2090-09-16T10:30', '2090-09-16T11:30', second, 1),
          /reservation_conflict/,
        );
        assert.equal(
          await scalar('select version v from public.reservations where id=$1', [second]),
          1,
        );
        await reserve(h, r, '2090-09-16T13:00', '2090-09-16T14:00', second, 1);
        await assert.rejects(
          reserve(h, r, '2090-09-16T13:00', '2090-09-16T14:00', second, 1),
          /stale_version/,
        );
        await db.query('select public.cancel_reservation($1,$2,1)', [h, id]);
        await db.query('select public.cancel_reservation($1,$2,1)', [h, id]);
        await reserve(h, r, '2090-09-16T10:00', '2090-09-16T11:00');
        assert.equal(
          await scalar('select count(*)::int v from public.reservations where home_id=$1', [h]),
          3,
        );
      },
    );
    await t.test(
      'SQL local times: Madrid, UTC, Canary, DST gap/fold and timezone changes preserve instants',
      async () => {
        assert.equal(
          await scalar(
            "select public.calendar_local_instant('2026-09-16 18:00','Europe/Madrid')::text v",
          ),
          '2026-09-16 16:00:00+00',
        );
        assert.equal(
          await scalar(
            "select public.calendar_local_instant('2026-09-16 18:00','Atlantic/Canary')::text v",
          ),
          '2026-09-16 17:00:00+00',
        );
        await assert.rejects(
          db.query("select public.calendar_local_instant('2026-03-29 02:30','Europe/Madrid')"),
          /nonexistent_local_time/,
        );
        assert.equal(
          await scalar(
            "select public.calendar_local_instant('2026-10-25 02:30','Europe/Madrid')::text v",
          ),
          '2026-10-25 01:30:00+00',
        );
        const h = await fixture(),
          r = await resource(h),
          id = await reserve(h, r, '2090-09-16T18:00', '2090-09-16T19:00');
        const before = await scalar(
          'select starts_at::text v from public.reservations where id=$1',
          [id],
        );
        await db.query("select public.update_home_timezone($1,'Europe/Madrid')", [h]);
        assert.equal(
          await scalar('select starts_at::text v from public.reservations where id=$1', [id]),
          before,
        );
        await assert.rejects(
          reserve(h, r, '2090-09-17T18:00', '2090-09-17T19:00'),
          /stale_timezone/,
        );
      },
    );
    await t.test(
      'activities auto-join creator; attendance idempotent, edit retains participants, cancellation hides operation',
      async () => {
        const h = await fixture(),
          id = await activity(h);
        assert.equal(
          await scalar(
            'select attending v from public.activity_members where activity_id=$1 and user_id=$2',
            [id, a],
          ),
          true,
        );
        await as(b);
        await db.query('select public.set_activity_attendance($1,$2,true)', [h, id]);
        await db.query('select public.set_activity_attendance($1,$2,true)', [h, id]);
        assert.equal(
          await scalar('select count(*)::int v from public.activity_members where activity_id=$1', [
            id,
          ]),
          2,
        );
        await activity(h, id, 1, 'Cine');
        assert.equal(
          await scalar(
            'select count(*)::int v from public.activity_members where activity_id=$1 and attending',
            [id],
          ),
          2,
        );
        await db.query('select public.set_activity_attendance($1,$2,false)', [h, id]);
        await db.query('select public.set_activity_attendance($1,$2,false)', [h, id]);
        assert.equal(
          await scalar(
            'select count(*)::int v from public.activity_members where activity_id=$1 and attending',
            [id],
          ),
          1,
        );
        await db.query('select public.cancel_activity($1,$2,2)', [h, id]);
        await assert.rejects(
          db.query('select public.set_activity_attendance($1,$2,true)', [h, id]),
          /not_found/,
        );
        await assert.rejects(
          activity(h, randomUUID(), 0, 'Bad', '2090-09-16T21:00', '2090-09-16T20:00'),
          /invalid_time/,
        );
      },
    );
    await t.test('four-table RLS, cross-home RPC, direct writes and anonymous access', async () => {
      const h = await fixture(),
        r = await resource(h),
        id = await activity(h);
      await as(out);
      for (const table of ['resources', 'reservations', 'activities', 'activity_members'])
        assert.equal(
          await scalar(`select count(*)::int v from public.${table} where home_id=$1`, [h]),
          0,
        );
      await assert.rejects(resource(h), /unauthorized/);
      await assert.rejects(reserve(h, r, '2090-09-16T10:00', '2090-09-16T11:00'), /unauthorized/);
      await assert.rejects(
        db.query('select public.set_activity_attendance($1,$2,true)', [h, id]),
        /unauthorized/,
      );
      const other = await fixture();
      await assert.rejects(
        reserve(other, r, '2090-09-16T10:00', '2090-09-16T11:00'),
        /resource_unavailable/,
      );
      await assert.rejects(activity(other, id, 1), /not_found/);
      await assert.rejects(
        db.query('update public.resources set active=false where id=$1', [r]),
        /permission denied/,
      );
      await db.exec('reset role;set role anon');
      await assert.rejects(resource(h), /permission denied/);
      await as(a);
    });
    await t.test(
      'departure cancels future bookings and future attendance but preserves snapshots and denies rejoin action',
      async () => {
        const h = await fixture(),
          r = await resource(h),
          reservation = await reserve(
            h,
            r,
            '2090-09-16T10:00',
            '2090-09-16T11:00',
            randomUUID(),
            0,
            b,
          ),
          act = await activity(h);
        await as(b);
        await db.query('select public.set_activity_attendance($1,$2,true)', [h, act]);
        await db.query('select public.leave_home($1)', [h]);
        await assert.rejects(
          db.query('select public.set_activity_attendance($1,$2,true)', [h, act]),
          /unauthorized/,
        );
        await as(a);
        assert.equal(
          await scalar('select cancellation_reason v from public.reservations where id=$1', [
            reservation,
          ]),
          'member_left',
        );
        assert.equal(
          await scalar('select responsible_name v from public.reservations where id=$1', [
            reservation,
          ]),
          'Bob',
        );
        assert.equal(
          await scalar(
            'select attending v from public.activity_members where activity_id=$1 and user_id=$2',
            [act, b],
          ),
          false,
        );
        await reserve(h, r, '2090-09-16T10:00', '2090-09-16T11:00');
      },
    );
  } finally {
    await db.close();
  }
});
