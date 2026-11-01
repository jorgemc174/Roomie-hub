import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { organizationDatabase } from './helpers/database';

test('editing chore deadlines preserves expired boundaries and unissued overdue days', async () => {
  const { db, home, as, users, scalar } = await organizationDatabase();
  try {
    const h = await home(1);
    await db.exec('reset role; begin');
    await db.query(
      "update public.home_members set joined_at=now()-interval '20 days' where home_id=$1",
      [h],
    );
    const chore = await scalar<string>(
      "insert into public.chores(home_id,name,difficulty,recurrence,anchor_date,assignment_mode,deadline_days,deadline_timezone) values($1,'Original',1,'daily',current_date-10,'automatic',0,'UTC') returning id v",
      [h],
    );
    // Owner-only clock fixtures: no penalties have been reconciled yet.
    const instances = (
      await db.query<{ id: string; deadline: string | null; protected: boolean }>(
        `insert into public.chore_instances(home_id,chore_id,period_start,period_end,task_name,difficulty,assignee_id,assignee_name,deadline_at)
         select $1,$2,current_date-days,current_date+1,'Original',1,$3,'Alice',deadline
         from (values (5,now()-interval '3 days 5 minutes'),(4,now()-interval '12 hours'),(3,now()),(2,now()+interval '5 days'),(1,null::timestamptz)) fixtures(days,deadline)
         returning id,deadline_at::text deadline,coalesce(deadline_at<=now(),false) protected`,
        [h, chore, users[0]],
      )
    ).rows;
    await as(users[0]);
    const save = (due: number | null, zone: string) =>
      db.query(
        "select public.save_chore($1,$2,'Renamed','',5,true,'daily',1,current_date-10,'automatic','{}',$3,'23:00',$4)",
        [h, chore, due, zone],
      );
    for (const [due, zone] of [
      [365, 'UTC'],
      [null, 'Europe/Madrid'],
    ] as const) {
      await save(due, zone);
      for (const original of instances) {
        const current = await scalar<{ deadline: string | null; name: string; difficulty: number }>(
          "select jsonb_build_object('deadline',deadline_at::text,'name',task_name,'difficulty',difficulty) v from public.chore_instances where id=$1",
          [original.id],
        );
        assert.equal(current.name, 'Renamed');
        assert.equal(current.difficulty, 5);
        if (original.protected) assert.equal(current.deadline, original.deadline);
        else if (due === null) assert.equal(current.deadline, null);
        else assert.notEqual(current.deadline, original.deadline);
      }
    }
    for (let n = 0; n < 2; n++) {
      await db.query('select public.reconcile_community($1)', [h]);
      const ratings = (
        await db.query<{ overdue_day: number; boundary_preserved: boolean }>(
          `select overdue_day,effective_at=i.deadline_at+overdue_day*interval '24 hours' boundary_preserved
           from public.ratings r join public.chore_instances i on i.id=r.source_id
           where r.home_id=$1 order by overdue_day`,
          [h],
        )
      ).rows;
      assert.deepEqual(
        ratings,
        [1, 2, 3].map((overdue_day) => ({ overdue_day, boundary_preserved: true })),
      );
    }
    await db.exec('commit');
  } finally {
    await db.close();
  }
});

test('delete_expense rejects a null version without changing the expense or its audit', async () => {
  const { db, home, users, scalar } = await organizationDatabase();
  try {
    const h = await home(1);
    const id = randomUUID();
    await db.query('select public.save_expense($1,$2,0,$3)', [h, id, expenseBody(users[0])]);
    const snapshot = () =>
      scalar<string>(
        "select jsonb_build_object('expense',to_jsonb(e),'events',(select jsonb_agg(to_jsonb(a) order by revision) from public.expense_events a where expense_id=e.id))::text v from public.expenses e where id=$1",
        [id],
      );
    const before = await snapshot();
    await assert.rejects(
      db.query('select public.delete_expense($1,$2,null)', [h, id]),
      /stale_version/,
    );
    assert.equal(await snapshot(), before);
    await assert.rejects(
      db.query('select public.delete_expense($1,$2,2)', [h, id]),
      /stale_version/,
    );
    await db.query('select public.delete_expense($1,$2,1)', [h, id]);
    assert.equal(
      await scalar<number>('select version v from public.expenses where id=$1', [id]),
      2,
    );
    await db.query('select public.delete_expense($1,$2,1)', [h, id]);
    await assert.rejects(
      db.query('select public.delete_expense($1,$2,null)', [h, id]),
      /stale_version/,
    );
  } finally {
    await db.close();
  }
});

function expenseBody(payer: string) {
  return {
    title: 'Bill',
    amount: '100',
    date: '2026-10-01',
    payer,
    category: 'other',
    split_mode: 'equal',
    participants: [{ user_id: payer, weight: '1' }],
  };
}

test('recurrence creation retries reject changed content and preserve identical normalized requests', async () => {
  const { db, home, users, scalar } = await organizationDatabase();
  try {
    const h = await home(1);
    const body = expenseBody(users[0]);
    const anchor = await scalar<string>('select public.home_local_date($1)::text v', [h]);
    const id = randomUUID();
    const save = (changes: Record<string, unknown> = {}, version = 0) => {
      const p = {
        body,
        kind: 'fixed',
        frequency: 'monthly',
        n: 1,
        anchor,
        enabled: true,
        ...changes,
      };
      return scalar<string>('select public.save_recurring_expense($1,$2,$3,$4,$5,$6,$7,$8,$9) v', [
        h,
        id,
        version,
        p.body,
        p.kind,
        p.frequency,
        p.n,
        p.anchor,
        p.enabled,
      ]);
    };
    assert.equal(await save(), id);
    const snapshot = () =>
      scalar<string>('select to_jsonb(r)::text v from public.recurring_expenses r where id=$1', [
        id,
      ]);
    const before = await snapshot();
    assert.equal(await save(), id);
    assert.equal(await snapshot(), before);
    for (const changes of [
      { body: { ...body, title: 'Changed' } },
      { body: { ...body, amount: '200' } },
      { kind: 'variable' },
      { frequency: 'weekly' },
      { n: 2 },
      { anchor: '2026-10-02' },
      { enabled: false },
    ]) {
      await assert.rejects(save(changes), /idempotency_conflict/);
      assert.equal(await snapshot(), before);
    }
    // Progress is not request content: generating a period must not break an identical retry.
    await db.query('select public.generate_recurring_expenses($1)', [h]);
    const progressed = await snapshot();
    assert.equal(await save(), id);
    assert.equal(await snapshot(), progressed);
    await assert.rejects(save({}, 99), /stale_version/);
    await save({ kind: 'variable' }, 1);
    assert.equal(
      await save({
        kind: 'variable',
        body: { ...body, amount: '999', shopping_list_id: randomUUID() },
      }),
      id,
    );
  } finally {
    await db.close();
  }
});
