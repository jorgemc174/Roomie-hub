import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { organizationDatabase } from './helpers/database';
import { homeDate, validTimezone } from '../src/lib/timezones';
import { addDays } from '../src/features/organization/logic';
import { ensureOrganizationPeriod } from '../src/features/organization/generation';

test('Compra/Ausencias perform no generation; tasks call only the bounded server entry point', async () => {
  const calls: unknown[] = [];
  const db = {
    rpc: async (name: 'ensure_current_chores', args: { target: string }) => {
      calls.push([name, args]);
      return { data: { created: 0, blocked: 0 }, error: null };
    },
  };
  for (const tab of ['shopping', 'absences']) {
    await ensureOrganizationPeriod(db, 'home', tab);
    assert.equal(calls.length, 0);
  }
  await ensureOrganizationPeriod(db, 'home', 'tasks');
  assert.deepEqual(calls, [['ensure_current_chores', { target: 'home' }]]);
});
test('home calendar near midnight, year boundary and DST is independent of machine timezone', () => {
  const instant = '2026-09-15T22:30:00Z';
  assert.equal(homeDate('Europe/Madrid', instant), '2026-09-16');
  assert.equal(homeDate('Atlantic/Canary', instant), '2026-09-15');
  assert.equal(homeDate('America/New_York', instant), '2026-09-15');
  assert.equal(homeDate('Asia/Tokyo', instant), '2026-09-16');
  assert.equal(homeDate('America/New_York', '2026-01-01T00:30:00Z'), '2025-12-31');
  assert.equal(homeDate('Europe/Madrid', '2026-03-29T01:30:00Z'), '2026-03-29');
  for (const zone of ['UTC', 'Europe/Madrid', 'Atlantic/Canary', 'America/New_York', 'Asia/Tokyo'])
    assert.ok(validTimezone(zone));
  for (const zone of ['PST', 'GMT+3', 'Invalid/Zone', '']) assert.equal(validTimezone(zone), false);
});
test('PostgreSQL task lifecycle, timezones and new members', async (t) => {
  const { db, users, home, as, scalar } = await organizationDatabase();
  const [alice, bob, , outsider] = users;
  const today = homeDate('UTC');
  const h = async (n = 2) => {
    const id = await home(n);
    await db.query("select public.update_home_timezone($1,'UTC')", [id]);
    return id;
  };
  const save = async (
    id: string,
    chore: string | null = null,
    changes: Record<string, unknown> = {},
  ) => {
    const p = {
      name: 'Lifecycle',
      weight: 3,
      active: true,
      kind: 'daily',
      n: 1,
      anchor: today,
      mode: 'automatic',
      rotation: [] as string[],
      due: null,
      ...changes,
    };
    return scalar<string>(
      "select public.save_chore($1,$2,$3,'',$4,$5,$6,$7,$8,$9,$10::uuid[],$11,'20:00','Europe/Madrid') v",
      [id, chore, p.name, p.weight, p.active, p.kind, p.n, p.anchor, p.mode, p.rotation, p.due],
    );
  };
  const gen = (id: string, days = 10) =>
    scalar<{ created: number; blocked: number }>(
      'select public.generate_chore_instances($1,$2,$3) v',
      [id, today, addDays(today, days)],
    );
  const ensure = (id: string) =>
    scalar<{ created: number; blocked: number }>('select public.ensure_current_chores($1) v', [id]);
  const rows = (id: string) =>
    db.query<{
      id: string;
      period_start: string;
      cancelled_at: string | null;
      assignee_id: string;
      difficulty: number;
    }>(
      'select id,period_start::text,cancelled_at::text,assignee_id,difficulty from public.chore_instances where home_id=$1 order by period_start,id',
      [id],
    );
  try {
    await t.test(
      'disable cancels only future pending; completed/current and assignment events remain unchanged',
      async () => {
        const id = await h();
        const chore = await save(id);
        await gen(id);
        const all = (await rows(id)).rows;
        const current = all[0],
          completed = all[5];
        await db.query('select public.complete_chore($1,$2)', [id, completed.id]);
        const snapshot = () =>
          scalar<string>(
            'select json_agg(i order by period_start)::text v from public.chore_instances i where id=any($1::uuid[])',
            [[current.id, completed.id]],
          );
        const before = await snapshot();
        await save(id, chore, { active: false });
        assert.equal(await snapshot(), before);
        assert.equal((await rows(id)).rows.filter((i) => i.cancelled_at).length, 9);
        assert.equal(
          await scalar<number>(
            'select count(*)::int v from public.chore_assignment_events where home_id=$1',
            [id],
          ),
          11,
        );
        assert.equal((await ensure(id)).created, 0);
        await assert.rejects(
          db.query('select public.complete_chore($1,$2)', [id, all[1].id]),
          /not_found/,
        );
        await db.exec('reset role');
        await assert.rejects(
          db.query("update public.chore_instances set task_name='Rewrite' where id=$1", [
            completed.id,
          ]),
          /closed_instance_immutable/,
        );
        await as(alice);
        await save(id, chore);
        await gen(id);
        assert.equal((await gen(id)).created, 0);
        assert.equal(
          await scalar<number>(
            'select count(*)::int v from public.chore_instances where home_id=$1 and cancelled_at is null',
            [id],
          ),
          11,
        );
        assert.equal(await snapshot(), before);
      },
    );
    await t.test(
      'changing recurrence cancels future daily rows and issues non-overlapping weekly rows',
      async () => {
        const id = await h();
        const chore = await save(id);
        await gen(id, 21);
        const current = (await rows(id)).rows[0];
        await save(id, chore, { kind: 'weekly' });
        await gen(id, 21);
        assert.equal(
          await scalar<number>(
            'select count(*)::int v from public.chore_instances where home_id=$1 and cancelled_at is not null',
            [id],
          ),
          21,
        );
        const live = (
          await db.query<{ days: number; dow: number }>(
            'select period_end-period_start days,extract(dow from period_start)::int dow from public.chore_instances where home_id=$1 and cancelled_at is null and id<>$2',
            [id, current.id],
          )
        ).rows;
        assert.ok(live.length > 0);
        for (const r of live) {
          assert.equal(r.days, 7);
          assert.equal(r.dow, 1);
        }
        assert.equal((await gen(id, 21)).created, 0);
      },
    );
    await t.test(
      'rotation changes cancel future assignments; no-op saves do not cancel; current owner stays',
      async () => {
        const id = await h();
        const chore = await save(id, null, { mode: 'manual', rotation: [alice, bob] });
        await gen(id, 2);
        const initial = (await rows(id)).rows;
        await save(id, chore, { mode: 'manual', rotation: [bob, alice] });
        assert.equal((await rows(id)).rows.filter((i) => i.cancelled_at).length, 2);
        await ensure(id);
        const future = (await rows(id)).rows.find(
          (i) => !i.cancelled_at && i.period_start === addDays(today, 1),
        )!;
        assert.equal(future.assignee_id, bob);
        await save(id, chore, { mode: 'manual', rotation: [bob, alice] });
        assert.equal((await ensure(id)).created, 0);
        assert.equal((await rows(id)).rows.find((i) => i.id === initial[0].id)!.assignee_id, alice);
        assert.equal((await rows(id)).rows.find((i) => i.id === future.id)!.cancelled_at, null);
      },
    );
    await t.test(
      'weight, anchor, assignment mode and deadlines invalidate future without rewriting current snapshots',
      async () => {
        const id = await h();
        const chore = await save(id);
        await ensure(id);
        const original = (await rows(id)).rows[0];
        await save(id, chore, {
          weight: 5,
          anchor: addDays(today, 1),
          mode: 'manual',
          rotation: [bob],
          due: 1,
        });
        await ensure(id);
        const active = (await rows(id)).rows.filter((i) => !i.cancelled_at);
        assert.equal(active.find((i) => i.id === original.id)!.difficulty, 3);
        assert.equal(active.find((i) => i.period_start === addDays(today, 1))!.difficulty, 5);
        assert.equal(active.find((i) => i.period_start === addDays(today, 1))!.assignee_id, bob);
      },
    );
    await t.test(
      'new member invalidates automatic future only, participates next day, repeated join is harmless',
      async () => {
        const id = await h(1);
        await save(id);
        await gen(id, 20);
        const code = await scalar<string>(
          'select code v from public.invitations where home_id=$1',
          [id],
        );
        await as(bob);
        await db.query('select public.join_home($1)', [code]);
        assert.equal((await rows(id)).rows.filter((i) => i.cancelled_at).length, 20);
        await ensure(id);
        const live = (await rows(id)).rows.filter((i) => !i.cancelled_at);
        assert.equal(live.find((i) => i.period_start === today)!.assignee_id, alice);
        assert.equal(live.find((i) => i.period_start === addDays(today, 1))!.assignee_id, bob);
        await db.query('select public.join_home($1)', [code]);
        assert.equal((await ensure(id)).created, 0);
      },
    );
    await t.test(
      'timezone validation, SQL midnight parity, short horizon and cutover preserve deadline instants',
      async () => {
        await as(alice);
        const fresh = await scalar<string>("select public.create_home('Timezone home') v");
        assert.equal(
          await scalar<string>('select timezone v from public.homes where id=$1', [fresh]),
          'Europe/Madrid',
        );
        for (const zone of ['Europe/Madrid', 'Atlantic/Canary', 'America/New_York', 'Asia/Tokyo']) {
          await db.query('select public.update_home_timezone($1,$2)', [fresh, zone]);
          const stamp = '2026-09-15T22:30:00Z';
          assert.equal(
            await scalar<string>('select public.home_local_date($1,$2)::text v', [fresh, stamp]),
            homeDate(zone, stamp),
          );
        }
        await assert.rejects(
          db.query("select public.update_home_timezone($1,'PST')", [fresh]),
          /invalid_timezone/,
        );
        await assert.rejects(
          db.query("select public.update_home_timezone($1,'Not/A_Zone')", [fresh]),
          /invalid_timezone/,
        );
        const id = await h();
        await save(id, null, { due: 1 });
        await gen(id, 20);
        const current = (await rows(id)).rows[0];
        const before = await scalar<string>(
          'select row_to_json(i)::text v from public.chore_instances i where id=$1',
          [current.id],
        );
        await db.query("select public.update_home_timezone($1,'Asia/Tokyo')", [id]);
        assert.equal(
          await scalar<string>(
            'select row_to_json(i)::text v from public.chore_instances i where id=$1',
            [current.id],
          ),
          before,
        );
        await ensure(id);
        const local = homeDate('Asia/Tokyo');
        assert.ok(
          (await rows(id)).rows
            .filter((i) => !i.cancelled_at)
            .every((i) => i.period_start <= addDays(local, 1)),
        );
        assert.equal((await ensure(id)).created, 0);
      },
    );
    await t.test(
      'new RPCs and audit tombstones still enforce home RLS and helper permissions',
      async () => {
        const id = await h();
        const chore = await save(id);
        await gen(id);
        await save(id, chore, { active: false });
        await as(outsider);
        assert.equal((await rows(id)).rows.length, 0);
        assert.equal(
          await scalar<string | null>('select public.home_local_date($1)::text v', [id]),
          null,
        );
        await assert.rejects(ensure(id), /unauthorized/);
        await assert.rejects(
          db.query("select public.update_home_timezone($1,'Asia/Tokyo')", [id]),
          /unauthorized/,
        );
        await assert.rejects(
          db.query("select public.cancel_future_chores($1,null,'horizon_reset',$2)", [id, today]),
          /permission denied/,
        );
        await db.exec('reset role; set role anon');
        await assert.rejects(ensure(id), /permission denied/);
      },
    );
  } finally {
    await db.close();
  }
});
test('004 upgrades populated 003 without erasing completed rows or events; existing homes stay UTC', async () => {
  const { db, home, as, users, scalar } = await organizationDatabase(
    '202609150003_organization.sql',
  );
  try {
    const id = await home(1);
    const today = homeDate('UTC');
    await db.query(
      "select public.save_chore($1,null,'Legacy','',3,true,'daily',1,$2,'automatic','{}',null,'20:00','UTC')",
      [id, today],
    );
    await db.query('select public.generate_chore_instances($1,$2,$3)', [
      id,
      today,
      addDays(today, 30),
    ]);
    const completed = await scalar<string>(
      'select id v from public.chore_instances where home_id=$1 and period_start=$2',
      [id, addDays(today, 5)],
    );
    await db.query('select public.complete_chore($1,$2)', [id, completed]);
    const stamp = await scalar<string>(
      'select completed_at::text v from public.chore_instances where id=$1',
      [completed],
    );
    await db.exec('reset role');
    await db.exec(
      await readFile('supabase/migrations/202609150004_task_lifecycle_timezone.sql', 'utf8'),
    );
    await as(users[0]);
    assert.equal(
      await scalar<string>('select timezone v from public.homes where id=$1', [id]),
      'UTC',
    );
    assert.equal(
      await scalar<string>('select completed_at::text v from public.chore_instances where id=$1', [
        completed,
      ]),
      stamp,
    );
    assert.equal(
      await scalar<number>(
        'select count(*)::int v from public.chore_instances where home_id=$1 and cancelled_at is not null',
        [id],
      ),
      29,
    );
    assert.equal(
      await scalar<number>(
        'select count(*)::int v from public.chore_assignment_events where home_id=$1',
        [id],
      ),
      31,
    );
  } finally {
    await db.close();
  }
});
