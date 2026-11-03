import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActivityLocationFields } from '../src/features/calendar/activity-location-fields';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { organizationDatabase } from './helpers/database';
import { serverModule } from './helpers/server-module';
import * as calendarLogic from '../src/features/calendar/logic';
import type { ActionState } from '../src/app/actions';
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
    scalar<string>(
      "select public.save_activity_plan($1,$2,$3,$4,$5,$6,$7,$8,$9,'home',array[]::uuid[]) v",
      [h, id, v, title, 'Description', 'En casa', s, e, zone],
    );
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

test('PA 1268: editing an ended activity does not add retroactive participants', async () => {
  const { db, as, users, home, scalar } = await organizationDatabase();
  const [a, b, c] = users;
  try {
    const h = await home();
    await db.query("select public.update_home_timezone($1,'UTC')", [h]);
    const id = randomUUID();
    await db.query(
      "select public.save_activity_plan($1,$2,0,'Dinner','','Kitchen','2090-09-16 21:00',null,'UTC','home',$3::uuid[])",
      [h, id, [b]],
    );
    await db.exec('reset role');
    await db.query(
      "update public.activities set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' where id=$1",
      [id],
    );
    const start = await scalar(
      "select (starts_at at time zone 'UTC')::text v from public.activities where id=$1",
      [id],
    );
    const end = await scalar(
      "select (ends_at at time zone 'UTC')::text v from public.activities where id=$1",
      [id],
    );
    await as(a);
    await db.query(
      "select public.save_activity_plan($1,$2,1,'Dinner','','Kitchen',$3,$4,'UTC','home',$5::uuid[])",
      [h, id, start, end, [b, c]],
    );
    assert.equal(
      await scalar(
        'select count(*)::int v from public.activity_members where activity_id=$1 and user_id=$2',
        [id, c],
      ),
      0,
    );
  } finally {
    await db.close();
  }
});

test('PA 1268/1269: location, selected active participants and three idempotent responses', async () => {
  const { db, as, users, home, scalar } = await organizationDatabase();
  const [a, b, c, out] = users;
  try {
    const h = await home();
    await db.query("select public.update_home_timezone($1,'UTC')", [h]);
    const id = randomUUID();
    const save = (version = 0, kind: string | null = 'home', selected = [b]) =>
      db.query(
        "select public.save_activity_plan($1,$2,$3,'Dinner','','Kitchen','2090-09-16 21:00',null,'UTC',$4,$5::uuid[])",
        [h, id, version, kind, selected],
      );
    await assert.rejects(
      db.query(
        "select public.save_activity($1,$2,0,'Bypass','','','2090-09-16 21:00',null,'UTC')",
        [h, id],
      ),
      /permission denied/,
    );
    await assert.rejects(save(0, null), /invalid_location_kind/);
    await assert.rejects(save(0, 'elsewhere'), /invalid_location_kind/);
    await assert.rejects(save(0, 'home', [out]), /invalid_member/);
    await save();
    await save(0, 'home', [b, b]);
    assert.equal(
      await scalar('select location_kind v from public.activities where id=$1', [id]),
      'home',
    );
    assert.equal(
      await scalar('select count(*)::int v from public.activity_members where activity_id=$1', [
        id,
      ]),
      2,
    );
    await assert.rejects(save(0, 'outside'), /idempotency_conflict/);
    await as(b);
    for (const response of ['maybe', 'not_going', 'going']) {
      await db.query('select public.respond_activity($1,$2,$3)', [h, id, response]);
      const before = await scalar(
        'select updated_at::text v from public.activity_members where activity_id=$1 and user_id=$2',
        [id, b],
      );
      await db.query('select public.respond_activity($1,$2,$3)', [h, id, response]);
      assert.equal(
        await scalar(
          'select updated_at::text v from public.activity_members where activity_id=$1 and user_id=$2',
          [id, b],
        ),
        before,
      );
      assert.equal(
        await scalar(
          'select attending v from public.activity_members where activity_id=$1 and user_id=$2',
          [id, b],
        ),
        response === 'going',
      );
    }
    await db.query("select public.respond_activity($1,$2,'not_going')", [h, id]);
    await save(1, 'outside', [b, c]);
    assert.equal(
      await scalar(
        'select response v from public.activity_members where activity_id=$1 and user_id=$2',
        [id, b],
      ),
      'not_going',
    );
    assert.equal(
      await scalar('select count(*)::int v from public.activity_members where activity_id=$1', [
        id,
      ]),
      3,
    );
    // Creation replay still matches its immutable request after a later edit.
    await save();
    assert.equal(
      await scalar('select location_kind v from public.activities where id=$1', [id]),
      'outside',
    );
    await assert.rejects(save(1), /stale_version/);
    await assert.rejects(
      db.query("select public.respond_activity($1,$2,'bad')", [h, id]),
      /invalid_attendance/,
    );
    await as(c);
    await db.query("select public.respond_activity($1,$2,'maybe')", [h, id]);
    await db.query('select public.leave_home($1)', [h]);
    await as(a);
    await assert.rejects(save(2, 'outside', [c]), /invalid_member/);
    assert.equal(
      await scalar(
        'select response v from public.activity_members where activity_id=$1 and user_id=$2',
        [id, c],
      ),
      'not_going',
    );
    await as(out);
    assert.equal(
      await scalar('select count(*)::int v from public.activity_members where activity_id=$1', [
        id,
      ]),
      0,
    );
    await assert.rejects(
      db.query("select public.respond_activity($1,$2,'going')", [h, id]),
      /unauthorized/,
    );
    await assert.rejects(save(2), /unauthorized/);
    await as(a);
    await assert.rejects(
      db.query("update public.activity_members set response='going' where activity_id=$1", [id]),
      /permission denied/,
    );
    await db.query('select public.cancel_activity($1,$2,2)', [h, id]);
    await assert.rejects(
      db.query("select public.respond_activity($1,$2,'going')", [h, id]),
      /not_found/,
    );
  } finally {
    await db.close();
  }
});

test('PA 1268 C1: location and strict past-start validation through RPC and action', async (t) => {
  const { db, home, as, users, scalar } = await organizationDatabase();
  try {
    const h = await home();
    await db.query("select public.update_home_timezone($1,'UTC')", [h]);
    for (const channel of ['rpc', 'action'] as const) {
      for (const locale of ['es', 'en'] as const) {
        await t.test(`${channel}/${locale}`, async () => {
          const messages = calendarMessages(locale);
          let rpcCalls = 0;
          const { calendarAction } = await serverModule<{
            calendarAction: (
              h: string,
              op: string,
              state: ActionState,
              form: FormData,
            ) => Promise<ActionState>;
          }>('src/features/calendar/actions.ts', {
            'next/cache': { revalidatePath: () => {} },
            'next/navigation': { unstable_rethrow: () => {} },
            '@/lib/data': {
              getHome: async () => ({ timezone: 'UTC' }),
              requireUser: async () => ({
                db: {
                  rpc: async (name: string, args: Record<string, unknown>) => {
                    rpcCalls++;
                    assert.equal(name, 'save_activity_plan');
                    try {
                      await db.query(
                        'select public.save_activity_plan($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::uuid[])',
                        [
                          'target',
                          'item',
                          'expected_version',
                          'label',
                          'notes',
                          'place',
                          'start_local',
                          'end_local',
                          'expected_timezone',
                          'kind',
                          'participants',
                        ].map((key) => args[key]),
                      );
                      return { error: null };
                    } catch (error) {
                      return { error };
                    }
                  },
                },
              }),
            },
            '@/lib/i18n/server': { i18n: async () => ({ locale }) },
            './messages': { calendarMessages },
            './logic': calendarLogic,
          });
          const save = async ({
            id = randomUUID(),
            version = 0,
            kind = 'home',
            place = '',
            start = '2090-09-16T21:00:00',
            title = 'Dinner',
          } = {}) => {
            if (channel === 'rpc') {
              await db.query(
                'select public.save_activity_plan($1,$2,$3,$4,$5,$6,$7,null,$8,$9,$10::uuid[])',
                [h, id, version, title, '', place, start, 'UTC', kind, []],
              );
            } else {
              const form = new FormData();
              for (const [key, value] of Object.entries({
                id,
                version: String(version),
                location_kind: kind,
                location: place,
                start,
                title,
                timezone: 'UTC',
              }))
                form.set(key, value);
              const result = await calendarAction(h, 'activity', {}, form);
              if (result.error) throw new Error(result.error);
              assert.ok(result.success);
            }
          };
          for (const seconds of [1, 299]) {
            const start = await scalar<string>(
              "select ((now()-make_interval(secs=>$1)) at time zone 'UTC')::text v",
              [seconds],
            );
            await assert.rejects(
              save({ start: start!.replace(' ', 'T').slice(0, 19) }),
              channel === 'rpc'
                ? /past_start/
                : (error: Error) => {
                    assert.notEqual(error.message, messages.invalid);
                    assert.match(error.message, locale === 'es' ? /pasado/ : /past/);
                    assert.doesNotMatch(error.message, /5|five/);
                    return true;
                  },
            );
          }
          for (const place of ['', '   ', '\t\n']) {
            const before = rpcCalls;
            await assert.rejects(
              save({ kind: 'outside', place }),
              channel === 'rpc'
                ? /activity_location_required/
                : (error: Error) => {
                    assert.notEqual(error.message, messages.invalid);
                    assert.notEqual(error.message, messages.error);
                    assert.match(error.message, locale === 'es' ? /lugar/ : /location/);
                    return true;
                  },
            );
            if (channel === 'action') assert.equal(rpcCalls, before);
          }
          await save(); // Inside can omit the location.
          await save({ kind: 'outside', place: 'Cinema' });
          for (const elapsed of [60, 7200]) {
            const id = randomUUID();
            await save({ id });
            await save({ id }); // Replay with the original, unchanged payload.
            await db.exec('reset role');
            await db.query(
              'update public.activities set starts_at=now()-make_interval(secs=>$2) where id=$1',
              [id, elapsed],
            );
            await as(users[0]);
            const start = await scalar<string>(
              "select (starts_at at time zone 'UTC')::text v from public.activities where id=$1",
              [id],
            );
            // Match form precision, while retaining the exact original instant in SQL.
            await db.exec('reset role');
            await db.query(
              "update public.activities set starts_at=date_trunc('second',starts_at) where id=$1",
              [id],
            );
            await as(users[0]);
            const local = start!.replace(' ', 'T').slice(0, 19);
            await save({ id, version: 1, start: local, title: 'Edited' });
            assert.equal(
              await scalar('select version v from public.activities where id=$1', [id]),
              2,
            );
            await assert.rejects(save({ id, version: 2, start: '2000-01-01T12:00:00' }));
            // A creation replay remains valid after its original start is in the past.
            await db.exec('reset role');
            await db.query(
              "update public.activities set create_request=jsonb_set(create_request,'{start}',to_jsonb($2::timestamp)) where id=$1",
              [id, local],
            );
            await as(users[0]);
            await save({ id, start: local });
            assert.equal(
              await scalar('select version v from public.activities where id=$1', [id]),
              2,
            );
          }
        });
      }
    }
  } finally {
    await db.close();
  }
});

test('PA 1268 C1: outside place is required and associated with the localized field message', () => {
  for (const locale of ['es', 'en'] as const) {
    for (const initialKind of ['home', 'outside']) {
      const html = renderToStaticMarkup(
        createElement(ActivityLocationFields, {
          locale,
          initialKind,
          initialPlace: '',
        }),
      );
      const input = html.match(/<input[^>]*name="location"[^>]*>/)![0];
      assert.equal(input.includes('required=""'), initialKind === 'outside');
      if (initialKind === 'outside') {
        const describedBy = input.match(/aria-describedby="([^"]+)"/)![1];
        assert.ok(html.includes(`id="${describedBy}"`));
        assert.ok(html.includes(calendarMessages(locale).activityLocationRequired));
      }
    }
  }
});
