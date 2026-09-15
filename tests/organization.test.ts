import { test } from 'node:test';
import assert from 'node:assert/strict';
import { organizationDatabase } from './helpers/database';
import {
  addDays,
  overdueDays,
  validDate,
  validDifficulty,
  instanceStatus,
} from '../src/features/organization/logic';

test('overdue days count full elapsed days, stop at completion, handle offsets and no deadline', () => {
  const due = '2026-03-28T20:00:00Z';
  assert.equal(overdueDays(null, due), 0);
  assert.equal(overdueDays(due, '2026-03-29T19:59:59Z'), 0);
  assert.equal(overdueDays(due, '2026-03-29T20:00:00Z'), 1);
  assert.equal(overdueDays(due, '2026-04-02T20:00:00Z', '2026-03-30T20:00:00Z'), 2);
  assert.equal(overdueDays(due, '2026-03-28T19:00:00Z'), 0);
  assert.equal(overdueDays('2026-03-28T21:00:00+01:00', '2026-03-29T22:00:00+02:00'), 1);
  assert.equal(instanceStatus(due, null, '2026-03-28T20:00:01Z'), 'overdue');
  assert.equal(instanceStatus(due, due, '2026-03-30T20:00:00Z'), 'completed');
  assert.throws(() => overdueDays('invalid', due));
});
test('organization input boundaries', () => {
  for (const n of [1, 2, 3, 4, 5]) assert.ok(validDifficulty(n));
  for (const n of [0, 6, NaN, 2.5]) assert.equal(validDifficulty(n), false);
  assert.ok(validDate('2024-02-29'));
  assert.equal(validDate('2026-02-29'), false);
});
test('Phase 2 PostgreSQL: assignments, shopping, history, privileges and RLS', async (t) => {
  const { db, users, as, scalar, home } = await organizationDatabase();
  const [alice, bob, cara, outsider] = users;
  const today = new Date().toISOString().slice(0, 10);
  const create = async (
    h: string,
    weight = 3,
    mode = 'automatic',
    rotation: string[] = [],
    kind = 'daily',
    n = 1,
    anchor = today,
  ) =>
    scalar<string>(
      "select public.save_chore($1,null,'Task','', $2,true,$3,$4,$5,$6,$7::uuid[],null,'20:00','UTC') v",
      [h, weight, kind, n, anchor, mode, rotation],
    );
  const generate = async (h: string, start = today, end = start) =>
    scalar<{ created: number; blocked: number }>(
      'select public.generate_chore_instances($1,$2,$3) v',
      [h, start, end],
    );
  try {
    await t.test(
      'recurrences calculate current and next periods without monthly drift',
      async () => {
        const cases = [
          ['daily', 1, '2026-01-01', '2026-01-04', '2026-01-04', '2026-01-05'],
          ['days', 3, '2026-01-01', '2026-01-08', '2026-01-07', '2026-01-10'],
          ['weekly', 1, '2026-09-14', '2026-09-20', '2026-09-14', '2026-09-21'],
          ['weeks', 2, '2026-09-14', '2026-10-01', '2026-09-28', '2026-10-12'],
          ['monthly', 1, '2024-01-31', '2024-02-29', '2024-02-29', '2024-03-31'],
          ['monthly', 1, '2026-01-31', '2026-02-27', '2026-01-31', '2026-02-28'],
          ['monthly', 1, '2026-01-31', '2026-03-30', '2026-02-28', '2026-03-31'],
        ];
        for (const [kind, n, anchor, on, start, end] of cases) {
          const row = (
            await db.query<{ s: string; e: string }>(
              'select period_start::text s,period_end::text e from public.chore_period($1,$2,$3,$4)',
              [kind, n, anchor, on],
            )
          ).rows[0];
          assert.equal(row.s, start);
          assert.equal(row.e, end);
        }
        await assert.rejects(
          db.query("select * from public.chore_period('weekly',0,'2026-01-01','2026-01-01')"),
        );
      },
    );
    await t.test(
      'difficulty, recurrence, timezone and rotations validated by SQL; weekly home start honored',
      async () => {
        const h = await home();
        for (const w of [0, 6]) await assert.rejects(create(h, w));
        await assert.rejects(create(h, 3, 'manual', []));
        await assert.rejects(create(h, 3, 'manual', [alice, alice]));
        await assert.rejects(create(h, 3, 'manual', [outsider]));
        await assert.rejects(create(h, 3, 'automatic', [], 'days', 0));
        await assert.rejects(create(h, 3, 'automatic', [], 'invalid'));
        await db.query("select public.update_home($1,'Test home','EUR',null,0::smallint)", [h]);
        const c = await create(h, 3, 'automatic', [], 'weekly', 1, '2026-09-15');
        assert.equal(
          await scalar<string>('select anchor_date::text v from public.chores where id=$1', [c]),
          '2026-09-13',
        );
        await assert.rejects(
          db.query(
            "select public.save_chore($1,null,'Task','',3,true,'daily',1,$2,'automatic','{}',1,'20:00','invalid/zone')",
            [h, today],
          ),
        );
      },
    );
    await t.test(
      'automatic assignment balances weight, not count, and repeated generation is idempotent',
      async () => {
        const h = await home();
        for (const w of [5, 2, 2, 3]) await create(h, w);
        assert.equal((await generate(h)).created, 4);
        assert.equal((await generate(h)).created, 0);
        const loads = (
          await db.query<{ weight: number }>(
            'select sum(difficulty)::int weight from public.chore_instances where home_id=$1 group by assignee_id order by weight',
            [h],
          )
        ).rows;
        assert.deepEqual(
          loads.map((l) => l.weight),
          [3, 4, 5],
        );
        assert.equal(
          await scalar<number>(
            'select count(*)::int v from public.chore_assignment_events where home_id=$1',
            [h],
          ),
          4,
        );
        await assert.rejects(
          db.query('select public.generate_chore_instances($1,$2,$3)', [
            h,
            today,
            addDays(today, 367),
          ]),
        );
      },
    );
    await t.test(
      'manual rotation, absence skips and reassignments preserve completed history and snapshots',
      async () => {
        const h = await home();
        const c = await create(h, 3, 'manual', [alice, bob, cara]);
        await generate(h, today, addDays(today, 2));
        const rows = (
          await db.query<{ id: string; assignee_id: string }>(
            'select id,assignee_id from public.chore_instances where chore_id=$1 order by period_start',
            [c],
          )
        ).rows;
        assert.deepEqual(
          rows.map((r) => r.assignee_id),
          [alice, bob, cara],
        );
        await as(bob);
        await db.query('select public.complete_chore($1,$2)', [h, rows[0].id]);
        await db.query('select public.complete_chore($1,$2)', [h, rows[0].id]);
        const absence = await scalar<string>(
          'select public.save_absence($1,null,$2,$3,$4,false) v',
          [h, bob, addDays(today, 1), addDays(today, 1)],
        );
        assert.equal(
          await scalar<string>('select assignee_id v from public.chore_instances where id=$1', [
            rows[1].id,
          ]),
          cara,
        );
        assert.equal(
          await scalar<string>(
            'select completed_by_name v from public.chore_instances where id=$1',
            [rows[0].id],
          ),
          'Bob',
        );
        await db.query("update public.profiles set name='Bob changed' where id=$1", [bob]);
        assert.equal(
          await scalar<string>(
            'select completed_by_name v from public.chore_instances where id=$1',
            [rows[0].id],
          ),
          'Bob',
        );
        assert.equal(
          await scalar<number>(
            'select count(*)::int v from public.chore_assignment_events where instance_id=$1',
            [rows[1].id],
          ),
          2,
        );
        await db.query('select public.save_absence($1,$2,$3,$4,$4,true)', [h, absence, bob, today]);
        await generate(h, addDays(today, 3), addDays(today, 4));
        assert.deepEqual(
          (
            await db.query<{ assignee_id: string }>(
              'select assignee_id from public.chore_instances where chore_id=$1 order by period_start',
              [c],
            )
          ).rows.map((r) => r.assignee_id),
          [alice, cara, cara, alice, bob],
        );
        await assert.rejects(
          db.query('select public.save_absence($1,null,$2,$3,$4,false)', [
            h,
            bob,
            addDays(today, 1),
            today,
          ]),
        );
        await assert.rejects(
          db.query('select public.save_absence($1,null,$2,$3,$3,false)', [h, outsider, today]),
        );
      },
    );
    await t.test(
      'all absent: no ownerless instances, existing instances flagged and repaired on eligibility return',
      async () => {
        const h = await home(1);
        await create(h);
        await generate(h);
        const id = await scalar<string>('select public.save_absence($1,null,$2,$3,$3,false) v', [
          h,
          alice,
          today,
        ]);
        assert.equal(
          await scalar<boolean>(
            'select assignment_blocked v from public.chore_instances where home_id=$1',
            [h],
          ),
          true,
        );
        const c = await create(h);
        assert.ok((await generate(h)).blocked > 0);
        assert.equal(
          await scalar<number>(
            'select count(*)::int v from public.chore_instances where chore_id=$1',
            [c],
          ),
          0,
        );
        await db.query('select public.save_absence($1,$2,$3,$4,$4,true)', [h, id, alice, today]);
        assert.equal(
          await scalar<boolean>(
            'select assignment_blocked v from public.chore_instances where home_id=$1',
            [h],
          ),
          false,
        );
        assert.equal((await generate(h)).created, 1);
      },
    );
    await t.test(
      'inactive members lose operational access and never receive new automatic/manual assignments',
      async () => {
        const h = await home();
        await create(h, 5);
        await create(h, 1, 'manual', [bob, alice]);
        await generate(h);
        await db.exec('reset role');
        await db.query(
          'update public.home_members set active=false,left_at=now() where home_id=$1 and user_id=$2',
          [h, bob],
        );
        await as(alice);
        await generate(h, addDays(today, 1), addDays(today, 4));
        assert.equal(
          await scalar<number>(
            'select count(*)::int v from public.chore_instances where home_id=$1 and assignee_id=$2 and period_start>$3',
            [h, bob, today],
          ),
          0,
        );
        await as(bob);
        assert.equal(
          await scalar<number>(
            'select count(*)::int v from public.chore_instances where home_id=$1',
            [h],
          ),
          0,
        );
        await assert.rejects(generate(h));
      },
    );
    await t.test(
      'starter defaults are explicit, localized, idempotent and preserve edits',
      async () => {
        const h = await home(1);
        await db.query("select public.initialize_chores($1,'en')", [h]);
        await db.query("select public.initialize_chores($1,'es')", [h]);
        assert.equal(
          await scalar<number>('select count(*)::int v from public.chores where home_id=$1', [h]),
          5,
        );
        assert.equal(
          await scalar<string>(
            "select name v from public.chores where home_id=$1 and seed_key='default-1'",
            [h],
          ),
          'Clean kitchen',
        );
      },
    );
    await t.test(
      'deadlines store concrete DST-aware instants, optional deadlines remain null',
      async () => {
        const h = await home(1);
        const c = await scalar<string>(
          "select public.save_chore($1,null,'Deadline','',3,true,'daily',1,'2026-03-29','automatic','{}',0,'20:00','Europe/Madrid') v",
          [h],
        );
        await generate(h, '2026-03-29');
        assert.equal(
          await scalar<string>(
            "select to_char(deadline_at at time zone 'UTC','YYYY-MM-DD HH24:MI') v from public.chore_instances where chore_id=$1",
            [c],
          ),
          '2026-03-29 18:00',
        );
      },
    );
    await t.test(
      'shopping: any member creates, completes, unticks and deletes, whole-list completion is idempotent',
      async () => {
        const h = await home();
        const command = (
          op: string,
          list: string | null = null,
          item: string | null = null,
          label: string | null = null,
          checked = true,
        ) =>
          scalar<string>('select public.shopping_command($1,$2,$3,$4,$5,$6) v', [
            h,
            op,
            list,
            item,
            label,
            checked,
          ]);
        const l = await command('create_list', null, null, 'Groceries');
        await as(bob);
        const a = await command('add_item', l, null, 'Milk');
        const b = await command('add_item', l, null, 'Bread');
        await command('toggle_item', l, a, null, true);
        assert.equal(
          await scalar<string>(
            'select completed_by_name v from public.shopping_items where id=$1',
            [a],
          ),
          'Bob changed',
        );
        await as(cara);
        await command('complete_list', l);
        assert.equal(
          await scalar<number>(
            'select count(*)::int v from public.shopping_items where shopping_list_id=$1 and purchased',
            [l],
          ),
          2,
        );
        const stamp = await scalar<string>(
          'select completed_at::text v from public.shopping_lists where id=$1',
          [l],
        );
        await command('complete_list', l);
        assert.equal(
          await scalar<string>(
            'select completed_at::text v from public.shopping_lists where id=$1',
            [l],
          ),
          stamp,
        );
        await command('toggle_item', l, b, null, false);
        assert.equal(
          await scalar<string | null>(
            'select completed_at v from public.shopping_lists where id=$1',
            [l],
          ),
          null,
        );
        await command('rename_list', l, null, 'Weekend');
        assert.equal(
          await scalar<string>('select name v from public.shopping_lists where id=$1', [l]),
          'Weekend',
        );
        await command('delete_item', l, b);
        await command('delete_list', l);
        await assert.rejects(command('add_item', l, null, 'Late item'));
        assert.equal(
          await scalar<number>(
            'select count(*)::int v from public.shopping_items where shopping_list_id=$1 and deleted_at is null',
            [l],
          ),
          0,
        );
      },
    );
    await t.test(
      'all seven tables enforce RLS; foreign IDs and direct writes cannot bypass RPCs',
      async () => {
        const h = await home();
        const c = await create(h);
        await generate(h);
        const l = await scalar<string>(
          "select public.shopping_command($1,'create_list',null,null,'Private') v",
          [h],
        );
        await as(outsider);
        const other = await scalar<string>("select public.create_home('Other home') v");
        for (const table of [
          'chores',
          'chore_rotation_members',
          'chore_instances',
          'chore_assignment_events',
          'absences',
          'shopping_lists',
          'shopping_items',
        ]) {
          assert.equal(
            await scalar<number>(`select count(*)::int v from public.${table} where home_id=$1`, [
              h,
            ]),
            0,
          );
          await assert.rejects(db.query(`delete from public.${table} where home_id=$1`, [h]));
        }
        await assert.rejects(
          db.query("select public.shopping_command($1,'add_item',$2,null,'Attack')", [other, l]),
        );
        await assert.rejects(db.query('select public.complete_chore($1,$2)', [h, c]));
        await assert.rejects(
          db.query('select public.chore_eligible($1,$2,$3,$3)', [h, alice, today]),
        );
        await assert.rejects(db.query("select public.initialize_chores($1,'es')", [h]));
        await db.exec('reset role; set role anon');
        await assert.rejects(
          db.query('select public.generate_chore_instances($1,$2,$2)', [h, today]),
        );
      },
    );
    await t.test('publication contains the home-filterable soft-delete tables', async () => {
      await db.exec('reset role');
      const published = (
        await db.query<{ tablename: string }>(
          "select tablename from pg_publication_tables where pubname='supabase_realtime'",
        )
      ).rows.map((r) => r.tablename);
      for (const table of [
        'chores',
        'chore_instances',
        'absences',
        'shopping_lists',
        'shopping_items',
      ])
        assert.ok(published.includes(table));
    });
  } finally {
    await db.close();
  }
});
