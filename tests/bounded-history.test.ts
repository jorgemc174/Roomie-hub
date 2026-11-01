import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/supabase/database.types';
import { organizationDatabase } from './helpers/database';
import { readOrganizationRows } from '../src/features/organization/queries';
import {
  readReservationPage,
  readActivityPage,
  readActivityMembers,
  calendarPageIndex,
  calendarPageHref,
  calendarItem,
} from '../src/features/calendar/queries';
import { eventOnDay, normalizeCalendar } from '../src/features/calendar/logic';
import type { Reservation, Activity, ActivityMember } from '../src/features/calendar/models';
import type { ChoreInstance, AssignmentEvent } from '../src/features/organization/models';

// PGlite returns Date objects; PostgREST serializes SQL dates without a time part.
const wireRows = <Row>(rows: Row[]): Row[] =>
  JSON.parse(
    JSON.stringify(rows, (key, value: unknown) =>
      ['period_start', 'period_end'].includes(key) && typeof value === 'string'
        ? value.slice(0, 10)
        : value,
    ),
  );

// Execute the real Supabase client's generated filters against PostgreSQL/RLS in PGlite.
// This transport supports only the read operators these queries use, and records rows
// actually returned so equivalence does not conceal an unbounded history download.
function postgresTransport(pg: Awaited<ReturnType<typeof organizationDatabase>>['db']) {
  const reads: { table: string; count: number; url: URL }[] = [];
  const identifier = (name: string) => {
    assert.match(name, /^[a-z_]+$/);
    return `"${name}"`;
  };
  const split = (text: string) => {
    let depth = 0,
      start = 0;
    const parts: string[] = [];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '(') depth++;
      if (text[i] === ')') depth--;
      if (text[i] === ',' && depth === 0) {
        parts.push(text.slice(start, i));
        start = i + 1;
      }
    }
    return [...parts, text.slice(start)];
  };
  const client = createClient<Database>('http://postgrest.test', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const table = url.pathname.split('/').at(-1)!;
        const args: unknown[] = [];
        const value = (v: unknown) => {
          args.push(v);
          return `$${args.length}`;
        };
        const filter = (expr: string): string => {
          for (const op of ['or', 'and']) {
            if (expr.startsWith(`${op}(`))
              return `(${split(expr.slice(op.length + 1, -1))
                .map(filter)
                .join(` ${op} `)})`;
          }
          const match = expr.match(/^([a-z_]+)\.(not\.is|is|in|eq|gte|gt|lte|lt)\.(.*)$/)!;
          assert.ok(match, `Unsupported PostgREST expression ${expr}`);
          const [, field, op, arg] = match,
            column = identifier(field);
          if (op === 'is' || op === 'not.is') {
            assert.equal(arg, 'null');
            return `${column} ${op === 'is' ? 'is' : 'is not'} null`;
          }
          if (op === 'in') return `${column} in (${split(arg.slice(1, -1)).map(value).join(',')})`;
          const operators = { eq: '=', gt: '>', gte: '>=', lt: '<', lte: '<=' };
          return `${column} ${operators[op as keyof typeof operators]} ${value(arg)}`;
        };
        let source = `public.${identifier(table)}`;
        if (table === 'reservations_on_day') {
          const body = JSON.parse(String(init?.body)) as { target: string; on_day: string };
          source = `public.reservations_on_day(${value(body.target)}::uuid,${value(body.on_day)}::date)`;
        }
        const conditions: string[] = [];
        for (const [key, arg] of url.searchParams)
          if (!['select', 'order', 'offset', 'limit'].includes(key))
            conditions.push(
              filter(key === 'or' || key === 'and' ? `${key}${arg}` : `${key}.${arg}`),
            );
        const order = split(url.searchParams.get('order') ?? 'id.asc')
          .map((part) => {
            const [col, dir] = part.split('.');
            assert.ok(['asc', 'desc'].includes(dir));
            return `${identifier(col)} ${dir}`;
          })
          .join(',');
        const limit = Number(url.searchParams.get('limit') ?? 1000);
        const offset = Number(url.searchParams.get('offset') ?? 0);
        assert.ok(Number.isSafeInteger(limit) && Number.isSafeInteger(offset));
        const result = await pg.query(
          `select * from ${source}${conditions.length ? ` where ${conditions.join(' and ')}` : ''} order by ${order} limit ${limit} offset ${offset}`,
          args,
        );
        reads.push({ table, count: result.rows.length, url });
        return Response.json(wireRows(result.rows));
      },
    },
  });
  return { client, reads };
}

const now = '2026-11-01T12:00:00.000Z';
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
const sorted = <T extends { id: string; starts_at: string }>(rows: T[]) =>
  [...rows].sort(
    (a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.id.localeCompare(b.id),
  );

test('bounded history matches previous visible results, with old records, pagination and RLS', async (t) => {
  const { db, as, home, users } = await organizationDatabase();
  try {
    const h = await home(2),
      otherHome = await home(1);
    const resource = randomUUID(),
      resource2 = randomUUID(),
      chore = randomUUID();
    await db.exec('reset role');
    await db.query("update public.homes set timezone='Europe/Madrid' where id=$1", [h]);
    for (const r of [resource, resource2])
      await db.query(
        "insert into public.resources(id,home_id,name,created_by,created_by_name) values($1,$2,'Resource',$3,'Alice')",
        [r, h, users[0]],
      );
    await db.query(
      "insert into public.chores(id,home_id,name,difficulty,recurrence,anchor_date,assignment_mode) values($1,$2,'Task',1,'daily','2020-01-01','automatic')",
      [chore, h],
    );
    // A long completed history is absent from the visible month. Old pending and
    // cancelled occurrences remain eligible under the pre-existing 'from' semantics.
    for (let i = 0; i < 75; i++) {
      const person = users[i % 2],
        completed = i < 60,
        cancelled = i >= 70;
      const day = completed
        ? '2020-01-01'
        : i < 65 || cancelled
          ? '2026-10-01'
          : i < 69
            ? '2026-11-01'
            : '2026-12-20';
      const task = randomUUID();
      await db.query(
        `insert into public.chore_instances(id,home_id,chore_id,period_start,period_end,task_name,difficulty,assignee_id,assignee_name,completed_at,completed_by,completed_by_name,cancelled_at,cancellation_reason)
        values($1,$2,$3,$4::date+$5::int,$4::date+$5::int+1,'Task',1,$6,'Member',case when $7 then $8::timestamptz end,case when $7 then $6::uuid end,case when $7 then 'Member' end,case when $9 then $8::timestamptz end,case when $9 then 'definition_changed' end)`,
        [
          task,
          h,
          chore,
          day,
          completed ? i : i < 69 && !cancelled ? i % 5 : 0,
          person,
          completed,
          now,
          cancelled,
        ],
      );
      await db.query(
        "insert into public.chore_assignment_events(home_id,instance_id,assignee_id,assignee_name,reason,created_at) values($1,$2,$3,'Member','generated','2020-01-01')",
        [h, task, person],
      );
    }
    // More than two pages, null activity ends, simultaneous starts, cancelled
    // future records and exactly-ended records exercise all old predicates.
    for (let i = 0; i < 130; i++) {
      const start =
        i < 115
          ? `2020-01-01T${String(i % 20).padStart(2, '0')}:00:00Z`
          : i === 115
            ? '2026-11-01T11:00:00Z'
            : i === 116
              ? now
              : '2026-11-02T12:00:00Z';
      const end = i === 115 ? now : new Date(Date.parse(start) + 3600000).toISOString();
      const cancelled = i >= 125;
      // Cancelled old rows can overlap; future active rows use separate resources.
      await db.query(
        `insert into public.reservations(id,home_id,resource_id,resource_name,title,responsible_id,responsible_name,starts_at,ends_at,created_by,created_by_name,create_request,cancelled_at,cancellation_reason)
        values($1,$2,$3,'Resource','Booking',$4,'Alice',$5,$6,$4,'Alice','{}',case when $7 then $8::timestamptz end,case when $7 then 'cancelled' end)`,
        [randomUUID(), h, resource, users[0], start, end, true, now],
      );
      const activity = randomUUID();
      await db.query(
        `insert into public.activities(id,home_id,title,starts_at,ends_at,created_by,created_by_name,create_request,cancelled_at)
        values($1,$2,'Activity',$3,$4,$5,'Alice','{}',case when $6 then $7::timestamptz end)`,
        [activity, h, start, i % 2 ? end : null, users[0], cancelled, now],
      );
      await db.query(
        "insert into public.activity_members(home_id,activity_id,user_id,user_name,attending) values($1,$2,$3,'Alice',true),($1,$2,$4,'Bob',false)",
        [h, activity, users[0], users[1]],
      );
    }
    // Active bookings spanning local midnight and both DST changes, two resources.
    for (const [start, end, r] of [
      ['2026-11-01T11:00:00Z', now, resource],
      ['2026-11-02T12:00:00Z', '2026-11-02T13:00:00Z', resource],
      ['2026-11-02T12:00:00Z', '2026-11-02T13:00:00Z', resource2],
      ['2026-03-28T23:00:00Z', '2026-03-29T22:00:00Z', resource],
      ['2026-10-24T22:00:00Z', '2026-10-25T23:00:00Z', resource],
      ['2026-10-31T22:30:00Z', '2026-10-31T23:30:00Z', resource],
    ])
      await db.query(
        `insert into public.reservations(id,home_id,resource_id,resource_name,title,responsible_id,responsible_name,starts_at,ends_at,created_by,created_by_name,create_request)
        values($1,$2,$3,'Resource','Booking',$4,'Alice',$5,$6,$4,'Alice','{}')`,
        [randomUUID(), h, r, users[0], start, end],
      );
    const tasks = wireRows(
      (
        await db.query<ChoreInstance>(
          'select * from public.chore_instances where home_id=$1 order by period_start,id',
          [h],
        )
      ).rows,
    );
    const events = wireRows(
      (
        await db.query<AssignmentEvent>(
          'select * from public.chore_assignment_events where home_id=$1 order by created_at,id',
          [h],
        )
      ).rows,
    );
    const reservations = sorted(
      wireRows(
        (await db.query<Reservation>('select * from public.reservations where home_id=$1', [h]))
          .rows,
      ),
    );
    const activities = sorted(
      wireRows(
        (await db.query<Activity>('select * from public.activities where home_id=$1', [h])).rows,
      ),
    );
    const members = wireRows(
      (
        await db.query<ActivityMember>('select * from public.activity_members where home_id=$1', [
          h,
        ])
      ).rows,
    );
    await as(users[0]);
    const { client, reads } = postgresTransport(db);

    await t.test(
      'tasks keep backlog, mine/all/cancelled, from, and complete visible assignment history',
      async () => {
        for (const from of ['2026-11-01', '2020-01-01']) {
          const through = from === '2026-11-01' ? '2026-12-01' : '2020-01-31';
          for (const view of ['mine', 'all', 'cancelled', 'manage']) {
            reads.length = 0;
            const expected = tasks.filter(
              (i) =>
                view !== 'manage' &&
                (i.period_end > from || !i.completed_at) &&
                i.period_start <= through &&
                (view === 'cancelled' ? !!i.cancelled_at : !i.cancelled_at) &&
                (view !== 'mine' || i.assignee_id === users[0]),
            );
            const result = await readOrganizationRows(client, h, 'tasks', from, through, {
              view,
              userId: users[0],
            });
            assert.equal(result.instances.error, null);
            assert.equal(result.events.error, null);
            assert.deepEqual(ids(result.instances.data ?? []), ids(expected));
            assert.deepEqual(
              ids(result.events.data ?? []),
              ids(events.filter((e) => expected.some((i) => i.id === e.instance_id))),
            );
            const history = reads.filter((r) => r.table === 'chore_assignment_events');
            assert.equal(
              history.reduce((n, r) => n + r.count, 0),
              expected.length,
            );
            assert.ok(history.every((r) => r.url.searchParams.has('instance_id')));
          }
        }
      },
    );

    await t.test(
      'reservations page after filtering, exclusive midnight, 23/25-hour days and resources',
      async () => {
        for (const view of ['upcoming', 'history', 'all', 'day']) {
          for (const resourceFilter of ['', resource2]) {
            for (const day of view === 'day'
              ? ['2026-11-01', '2026-03-29', '2026-10-25', '2026-10-26']
              : ['2026-11-01']) {
              const expected = reservations.filter(
                (r) =>
                  (!resourceFilter || r.resource_id === resourceFilter) &&
                  (view === 'all' ||
                    (view === 'history'
                      ? !!r.cancelled_at || Date.parse(r.ends_at) <= Date.parse(now)
                      : !r.cancelled_at &&
                        (view === 'day'
                          ? eventOnDay(
                              {
                                startsAt: r.starts_at,
                                endsAt: r.ends_at,
                                allDay: false,
                              } as Parameters<typeof eventOnDay>[0],
                              day,
                              'Europe/Madrid',
                            )
                          : Date.parse(r.ends_at) > Date.parse(now)))),
              );
              const actual: Reservation[] = [];
              let page = 0,
                more = true;
              reads.length = 0;
              while (more) {
                const r = await readReservationPage(client, h, {
                  view,
                  day,
                  resource: resourceFilter,
                  now,
                  page,
                });
                assert.deepEqual(ids(r.rows), ids(expected.slice(page * 50, page * 50 + 50)));
                assert.equal(r.hasMore, expected.length > (page + 1) * 50);
                actual.push(...r.rows);
                more = r.hasMore;
                page++;
              }
              assert.deepEqual(ids(actual), ids(expected));
              assert.ok(reads.every((r) => r.count <= 51));
            }
          }
        }
      },
    );

    await t.test(
      'activities paginate before reading attending members; no-end, ended and cancelled semantics persist',
      async () => {
        for (const view of ['upcoming', 'history', 'all']) {
          const expected = activities.filter(
            (a) =>
              view === 'all' ||
              (view === 'history'
                ? !!a.cancelled_at || Date.parse(a.ends_at ?? a.starts_at) <= Date.parse(now)
                : !a.cancelled_at && Date.parse(a.ends_at ?? a.starts_at) > Date.parse(now)),
          );
          let page = 0,
            more = true;
          reads.length = 0;
          while (more) {
            const result = await readActivityPage(client, h, { view, now, page });
            const pageRows = expected.slice(page * 50, page * 50 + 50);
            assert.deepEqual(ids(result.rows), ids(pageRows));
            const participants = await readActivityMembers(client, h, ids(result.rows));
            assert.deepEqual(
              participants.map((m) => `${m.activity_id}/${m.user_id}`).sort(),
              members
                .filter((m) => m.attending && pageRows.some((a) => a.id === m.activity_id))
                .map((m) => `${m.activity_id}/${m.user_id}`)
                .sort(),
            );
            more = result.hasMore;
            page++;
          }
          assert.ok(reads.filter((r) => r.table === 'activities').every((r) => r.count <= 51));
          assert.ok(
            reads
              .filter((r) => r.table === 'activity_members')
              .every((r) => r.url.searchParams.has('activity_id')),
          );
        }
        reads.length = 0;
        assert.deepEqual(await readActivityMembers(client, h, []), []);
        assert.equal(reads.length, 0);
      },
    );

    await t.test('invalid resource and empty views do not download history', async () => {
      reads.length = 0;
      const result = await readReservationPage(client, h, {
        view: 'all',
        day: '2026-11-01',
        resource: 'invalid',
        now,
        page: 0,
      });
      assert.deepEqual(result, { rows: [], hasMore: false });
      assert.equal(reads.length, 0);
      assert.equal(
        (
          await readActivityPage(client, h, {
            view: 'upcoming',
            now: '2099-01-01T00:00:00Z',
            page: 0,
          })
        ).rows.length,
        0,
      );
    });

    await t.test('calendar deep links target records beyond the first history page', async () => {
      const a = activities.at(-1)!,
        r = reservations.at(-1)!;
      const events = normalizeCalendar(
        {
          homeId: h,
          tasks: [],
          reservations: [{ ...r, cancelled_at: null }],
          activities: [a],
          members: [],
          recurring: [],
          occurrences: [],
        },
        now,
      );
      for (const e of events)
        assert.equal(
          calendarItem(new URL(e.href, 'http://test').searchParams.get('item')!),
          e.sourceId,
        );
      assert.deepEqual(
        ids((await readActivityPage(client, h, { view: 'all', now, page: 99, item: a.id })).rows),
        [a.id],
      );
      assert.deepEqual(
        ids(
          (
            await readReservationPage(client, h, {
              view: 'all',
              now,
              day: '2026-11-01',
              resource: '',
              page: 99,
              item: r.id,
            })
          ).rows,
        ),
        [r.id],
      );
    });

    await t.test('day RPC retains RLS, invoker privileges and read-only clients', async () => {
      const sql = 'select count(*)::int n from public.reservations_on_day($1,$2)';
      assert.equal((await db.query<{ n: number }>(sql, [otherHome, '2026-11-02'])).rows[0].n, 0);
      await as(users[3]);
      assert.equal((await db.query<{ n: number }>(sql, [h, '2026-11-02'])).rows[0].n, 0);
      await assert.rejects(
        db.query('insert into public.reservations(id) values(gen_random_uuid())'),
        /permission denied/,
      );
      await db.exec('reset role; set role anon');
      await assert.rejects(db.query(sql, [h, '2026-11-02']), /permission denied/);
    });
  } finally {
    await db.close();
  }
});

test('calendar pagination validates the page and preserves view/day/resource without carrying create/item', () => {
  for (const v of [undefined, '', '-1', '1.5', '1000000', ['1']])
    assert.equal(calendarPageIndex(v), 0);
  assert.equal(calendarPageIndex('2'), 2);
  const url = new URL(
    calendarPageHref(
      '/reservations',
      {
        view: 'day',
        day: '2026-11-01',
        resource: 'abc',
        create: 'reservation',
        item: randomUUID(),
      },
      2,
    ),
    'http://test',
  );
  assert.equal(url.searchParams.get('view'), 'day');
  assert.equal(url.searchParams.get('day'), '2026-11-01');
  assert.equal(url.searchParams.get('resource'), 'abc');
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.has('create'), false);
  assert.equal(url.searchParams.has('item'), false);
  assert.equal(calendarItem('invalid'), undefined);
});
