import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { organizationDatabase } from './helpers/database';

test('departure settles accrued community penalties atomically before membership deactivation', async (t) => {
  const { db, as, home, scalar, users } = await organizationDatabase();
  const [ana, bob, , outside] = users;
  const fixture = async (days: number, current = false) => {
    const h = await home(2);
    await db.exec('reset role');
    await db.query(
      "update public.home_members set joined_at=now()-interval '2000 days' where home_id=$1",
      [h],
    );
    const chore = await scalar<string>(
      "insert into public.chores(home_id,name,difficulty,recurrence,anchor_date,assignment_mode) values($1,'Departure task',1,'daily',current_date-1000,'automatic') returning id v",
      [h],
    );
    const id = await scalar<string>(
      "insert into public.chore_instances(home_id,chore_id,period_start,period_end,task_name,difficulty,assignee_id,assignee_name,deadline_at) values($1,$2,current_date-1000,case when $4 then current_date+1 else current_date-1 end,'Departure task',1,$3,'Ana',now()-$5::integer*interval '24 hours'-interval '5 minutes') returning id v",
      [h, chore, ana, current, days],
    );
    await db.query(
      "insert into public.chore_assignment_events(home_id,instance_id,assignee_id,assignee_name,reason,created_at) values($1,$2,$3,'Ana','generated',now()-interval '2000 days')",
      [h, id, ana],
    );
    await as(ana);
    return { h, id };
  };
  const total = (id: string) =>
    scalar<number>(
      'select count(*)::int v from public.ratings where source_id=$1 and target_user_id=$2',
      [id, ana],
    );
  try {
    await t.test(
      'A: four unreconciled days become four historical negatives on leaving; repeated reconciliation is stable',
      async () => {
        const { h, id } = await fixture(4);
        assert.equal(await total(id), 0);
        await db.query('select public.leave_home($1)', [h]);
        assert.equal(await total(id), 0); // RLS denies the departed member.
        await assert.rejects(db.query('select public.leave_home($1)', [h]), /unauthorized/);
        await as(bob);
        const history = (
          await db.query('select * from public.ratings where source_id=$1 order by overdue_day', [
            id,
          ])
        ).rows;
        assert.equal(history.length, 4);
        for (let n = 0; n < 10; n++) await db.query('select public.reconcile_community($1)', [h]);
        assert.deepEqual(
          (
            await db.query('select * from public.ratings where source_id=$1 order by overdue_day', [
              id,
            ])
          ).rows,
          history,
        );
        assert.equal(
          await scalar<boolean>(
            'select active v from public.home_members where home_id=$1 and user_id=$2',
            [h, ana],
          ),
          false,
        );
      },
    );
    await t.test(
      'B: three more days after departure never penalize the former member',
      async () => {
        const { h, id } = await fixture(4);
        await db.query('select public.leave_home($1)', [h]);
        await db.exec('reset role');
        await db.query(
          "select community_private.issue_overdue($1,(select left_at+interval '3 days' from public.home_members where home_id=$1 and user_id=$2))",
          [h, ana],
        );
        assert.equal(await total(id), 4);
        assert.equal(
          await scalar<number>(
            "select count(*)::int v from community_private.penalty_days where instance_id=$1 and decision='inactive'",
            [id],
          ),
          3,
        );
      },
    );
    await t.test(
      'C: accrued threshold generates exactly one persistent punishment before leaving',
      async () => {
        const { h, id } = await fixture(5);
        await db.query('select public.leave_home($1)', [h]);
        await as(bob);
        assert.equal(await total(id), 5);
        for (let n = 0; n < 3; n++) await db.query('select public.reconcile_community($1)', [h]);
        const p = await db.query<{ threshold: number; severity: string }>(
          'select threshold,severity from public.punishments where home_id=$1 and user_id=$2',
          [h, ana],
        );
        assert.deepEqual(p.rows, [{ threshold: 5, severity: 'light' }]);
      },
    );
    await t.test(
      'D: 1003 decisions drain more than two batches with a frozen cutoff and no duplicates',
      async () => {
        const { h, id } = await fixture(1003);
        await db.exec('reset role');
        await db.exec('begin');
        // Put the final boundary exactly on the transaction instant, including subsecond precision.
        await db.query(
          "update public.chore_instances set deadline_at=now()-interval '1003 days' where id=$1",
          [id],
        );
        await db.exec('set role authenticated');
        await db.query('select public.leave_home($1)', [h]);
        await db.exec('reset role');
        assert.equal(await total(id), 1003);
        assert.equal(
          await scalar<boolean>(
            'select left_at=now() v from public.home_members where home_id=$1 and user_id=$2',
            [h, ana],
          ),
          true,
        );
        assert.equal(
          await scalar<boolean>(
            'select max(effective_at)=(select left_at from public.home_members where home_id=$1 and user_id=$3) v from public.ratings where source_id=$2',
            [h, id, ana],
          ),
          true,
        );
        assert.equal(
          await scalar<number>(
            'select count(distinct overdue_day)::int v from public.ratings where source_id=$1',
            [id],
          ),
          1003,
        );
        assert.equal(
          await scalar<number>(
            'select count(*)::int v from public.punishments where home_id=$1 and user_id=$2',
            [h, ana],
          ),
          200,
        );
        await db.exec('commit');
        await as(bob);
        await db.query('select public.reconcile_community($1)', [h]);
        assert.equal(await total(id), 1003);
      },
    );
    await t.test(
      'E: reentry starts a new eligibility window; unreconciled gap is skipped, subsequent boundary counts',
      async () => {
        const { h, id } = await fixture(4);
        const code = await scalar<string>(
          'select code v from public.invitations where home_id=$1',
          [h],
        );
        await db.query('select public.leave_home($1)', [h]);
        await db.query('select public.join_home($1)', [code]);
        assert.equal(
          await scalar<boolean>(
            'select penalty_active_since is not null v from public.home_members where home_id=$1 and user_id=$2',
            [h, ana],
          ),
          true,
        );
        await db.exec('reset role');
        // Owner-only virtual clock fixture: reentry three days after exit, no job during the gap.
        await db.query(
          "update public.home_members set penalty_active_since=(select max(effective_at)+interval '3 days 1 minute' from public.ratings where source_id=$3) where home_id=$1 and user_id=$2",
          [h, ana, id],
        );
        await db.query(
          'select community_private.issue_overdue($1,(select penalty_active_since from public.home_members where home_id=$1 and user_id=$2))',
          [h, ana],
        );
        assert.equal(await total(id), 4);
        for (let n = 0; n < 3; n++)
          await db.query(
            "select community_private.issue_overdue($1,(select penalty_active_since+interval '1 day' from public.home_members where home_id=$1 and user_id=$2))",
            [h, ana],
          );
        assert.equal(await total(id), 5);
        assert.equal(
          await scalar<number>('select max(overdue_day) v from public.ratings where source_id=$1', [
            id,
          ]),
          8,
        );
      },
    );
    await t.test(
      'financial debt blocks leaving without partial penalties or membership changes; outsider denied',
      async () => {
        const { h, id } = await fixture(4);
        await db.query('select public.save_expense($1,$2,0,$3::jsonb)', [
          h,
          randomUUID(),
          JSON.stringify({
            title: 'Shared bill',
            amount: '100',
            payer: ana,
            date: '2026-09-16',
            category: 'other',
            split_mode: 'equal',
            participants: [
              { user_id: ana, weight: '1' },
              { user_id: bob, weight: '1' },
            ],
          }),
        ]);
        await assert.rejects(db.query('select public.leave_home($1)', [h]), /outstanding_balance/);
        assert.equal(await total(id), 0);
        assert.equal(
          await scalar<boolean>(
            'select active v from public.home_members where home_id=$1 and user_id=$2',
            [h, ana],
          ),
          true,
        );
        await as(outside);
        await assert.rejects(db.query('select public.leave_home($1)', [h]), /unauthorized/);
        await assert.rejects(
          db.query('select community_private.issue_overdue($1,now())', [h]),
          /permission denied/,
        );
      },
    );
    await t.test('a failure after backlog processing rolls the entire departure back', async () => {
      const { h, id } = await fixture(5);
      await db.exec('reset role');
      await db.exec(
        `create function public.test_reject_departure() returns trigger language plpgsql as $$ begin if new.home_id='${h}'::uuid and not new.active then raise exception 'test_departure_failure';end if;return new;end $$;create trigger test_reject_departure before update on public.home_members for each row execute function public.test_reject_departure();`,
      );
      await as(ana);
      await assert.rejects(db.query('select public.leave_home($1)', [h]), /test_departure_failure/);
      assert.equal(await total(id), 0);
      assert.equal(
        await scalar<number>('select count(*)::int v from public.punishments where home_id=$1', [
          h,
        ]),
        0,
      );
      assert.equal(
        await scalar<boolean>(
          'select active v from public.home_members where home_id=$1 and user_id=$2',
          [h, ana],
        ),
        true,
      );
      await db.exec('reset role');
      assert.equal(
        await scalar<number>(
          'select count(*)::int v from community_private.penalty_progress where instance_id=$1',
          [id],
        ),
        0,
      );
      await db.exec(
        'drop trigger test_reject_departure on public.home_members;drop function public.test_reject_departure();',
      );
      await as(ana);
      await db.query('select public.leave_home($1)', [h]);
      await as(bob);
      assert.equal(await total(id), 5);
    });
    await t.test(
      'existing departure chore reassignment still follows settlement of old responsibility',
      async () => {
        const { h, id } = await fixture(4, true);
        await db.query('select public.leave_home($1)', [h]);
        await as(bob);
        assert.equal(await total(id), 4);
        assert.equal(
          await scalar<string>('select assignee_id v from public.chore_instances where id=$1', [
            id,
          ]),
          bob,
        );
        assert.equal(
          await scalar<number>(
            "select count(*)::int v from public.chore_assignment_events where instance_id=$1 and reason='reassigned'",
            [id],
          ),
          1,
        );
      },
    );
  } finally {
    await db.close();
  }
});
