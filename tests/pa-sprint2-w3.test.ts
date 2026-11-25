import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { organizationDatabase } from './helpers/database';
import {
  allowedReceiptExtension,
  RECEIPT_MAX_BYTES,
} from '../src/features/expenses/receipt-limits';
import { expenseMessages } from '../src/features/expenses/messages';
import { organizationMessages } from '../src/features/organization/messages';

test('W3 visible literals in Spanish and the receipt size boundary', () => {
  assert.equal(expenseMessages('es').zero, 'Estás saldado');
  assert.equal(
    expenseMessages('es').receiptInvalid,
    'Adjunto inválido: usa JPEG, PNG, WebP o PDF de hasta 10 MB.',
  );
  assert.equal(
    organizationMessages('es').productNameInvalid,
    'Escribe un nombre de lista o producto de entre 1 y 100 caracteres.',
  );
  assert.equal(allowedReceiptExtension('application/pdf', 5 * 1024 * 1024), 'pdf');
  assert.equal(allowedReceiptExtension('application/pdf', RECEIPT_MAX_BYTES), 'pdf');
  assert.equal(allowedReceiptExtension('application/pdf', RECEIPT_MAX_BYTES + 1), undefined);
  assert.equal(allowedReceiptExtension('text/plain', 10), undefined);
});

test('W3 transactional regressions on PostgreSQL', async (t) => {
  const {
    db,
    users: [alice, bob, cara, outsider],
    as,
    scalar,
    home,
  } = await organizationDatabase();
  const date = (h: string) => scalar<string>('select public.home_local_date($1)::text v', [h]);
  const split = (people: string[], weights = people.map(() => '1')) =>
    people.map((user_id, i) => ({ user_id, weight: weights[i] }));
  const body = (date: string, participants = split([alice, bob, cara]), mode = 'equal') => ({
    payer: alice,
    title: 'Recibo',
    date,
    amount: '1000',
    category: 'other',
    split_mode: mode,
    participants,
  });
  t.after(() => db.close());

  await t.test(
    '2457/2458/2461: five active unassigned definitions, then irrecoverable generic deletion',
    async () => {
      const h = await home(1);
      type Seed = { id: string; name: string; active: boolean; awaiting_assignment: boolean };
      const seeds = async () =>
        (
          await db.query<Seed>(
            'select id,name,active,awaiting_assignment from public.chores where home_id=$1 and deleted_at is null order by seed_key',
            [h],
          )
        ).rows;
      const initial = await seeds();
      assert.deepEqual(
        initial.map((s) => s.name),
        ['Limpiar cocina', 'Limpiar baño', 'Limpiar salón', 'Sacar basura', 'Fregar suelo'],
      );
      assert.ok(initial.every((s) => s.active && s.awaiting_assignment));
      const generated = await scalar<{ created: number }>(
        'select public.ensure_current_chores($1) v',
        [h],
      );
      assert.equal(generated.created, 0);
      assert.equal(
        await scalar('select count(*)::int v from public.chore_rotation_members where home_id=$1', [
          h,
        ]),
        0,
      );
      await db.query('select public.delete_chore($1,$2)', [h, initial[3].id]);
      await db.query("select public.initialize_chores($1,'en')", [h]);
      assert.deepEqual(
        await seeds(),
        initial.filter((_, index) => index !== 3),
      );
      await assert.rejects(
        db.query(
          "select public.save_chore($1,$2,'Restaurada','',1,true,'weekly',1,$3,'automatic','{}',null,'20:00','UTC')",
          [h, initial[3].id, await date(h)],
        ),
        /not_found/,
      );
    },
  );

  await t.test(
    '2472/2431: completing issues precisely the next occurrence and deletion preserves history',
    async () => {
      const h = await home(2);
      const today = await date(h);
      const task = await scalar<string>(
        "select public.save_chore($1,null,'Reciclaje','',2,true,'weeks',2,$2,'manual',$3,null,'20:00','UTC') v",
        [h, today, [alice, bob]],
      );
      await db.query('select public.generate_chore_instances($1,$2,$2)', [h, today]);
      const first = (
        await db.query<{ id: string; ends: string }>(
          'select id,period_end::text ends from public.chore_instances where chore_id=$1',
          [task],
        )
      ).rows[0];
      await db.query('select public.complete_chore($1,$2)', [h, first.id]);
      assert.equal(
        await scalar(
          'select assignee_id v from public.chore_instances where chore_id=$1 and period_start=$2',
          [task, first.ends],
        ),
        bob,
      );
      await db.query('select public.complete_chore($1,$2)', [h, first.id]);
      await db.query('select public.generate_chore_instances($1,$2,$2)', [h, first.ends]);
      assert.equal(
        await scalar('select count(*)::int v from public.chore_instances where chore_id=$1', [
          task,
        ]),
        2,
      );
      await as(outsider);
      await assert.rejects(
        db.query('select public.delete_chore($1,$2)', [h, task]),
        /unauthorized/,
      );
      await as(alice);
      await db.query('select public.delete_chore($1,$2)', [h, task]);
      assert.equal(
        await scalar(
          'select count(*)::int v from public.chore_instances where chore_id=$1 and completed_at is null and cancelled_at is null',
          [task],
        ),
        0,
      );
      assert.equal(
        await scalar('select completed_by v from public.chore_instances where id=$1', [first.id]),
        alice,
      );
      assert.equal(
        await scalar(
          'select count(*)::int v from public.chore_rotation_members where chore_id=$1',
          [task],
        ),
        0,
      );
    },
  );

  await t.test(
    '2346: both mutation paths are blocked for partial settlement, unrelated payments do not lock',
    async () => {
      const h = await home();
      const today = await date(h);
      const expense = randomUUID();
      const payload = body(today, split([alice, bob]));
      await db.query('select public.save_expense($1,$2,0,$3)', [h, expense, payload]);
      await db.query('select public.record_settlement($1,$2,$3,$4,100,$5)', [
        h,
        randomUUID(),
        cara,
        alice,
        today,
      ]);
      assert.deepEqual(
        await scalar('select public.settled_expense_ids($1,$2) v', [h, [expense]]),
        [],
      );
      await db.query('select public.record_settlement($1,$2,$3,$4,100,$5)', [
        h,
        randomUUID(),
        bob,
        alice,
        today,
      ]);
      assert.deepEqual(await scalar('select public.settled_expense_ids($1,$2) v', [h, [expense]]), [
        expense,
      ]);
      await assert.rejects(
        db.query('select public.save_expense($1,$2,1,$3)', [
          h,
          expense,
          { ...payload, amount: '999' },
        ]),
        /expense_has_settlement/,
      );
      await assert.rejects(
        db.query('select public.delete_expense($1,$2,1)', [h, expense]),
        /expense_has_settlement/,
      );
      assert.equal(await scalar('select version v from public.expenses where id=$1', [expense]), 1);
    },
  );

  await t.test(
    '2367/2368: active-only exact splits at the next run, posted ledger survives rule deletion',
    async () => {
      const h = await home();
      const today = await date(h);
      const rules = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
      const [equal, percentage, custom, empty] = rules;
      for (const [id, payload] of [
        [equal, body(today)],
        [
          percentage,
          body(today, split([alice, bob, cara], ['2000', '3000', '5000']), 'percentage'),
        ],
        [custom, body(today, split([alice, bob, cara], ['200', '300', '500']), 'custom')],
        [empty, body(today, split([cara]))],
      ] as const) {
        await db.query(
          "select public.save_recurring_expense($1,$2,0,$3,'fixed','weekly',1,$4,true)",
          [h, id, payload, today],
        );
      }
      await as(cara);
      await db.query('select public.leave_home($1)', [h]);
      await as(alice);
      await db.query('select public.generate_recurring_expenses($1)', [h]);
      const ledger = async (rule: string) =>
        (
          await db.query<{ user_id: string; amount: string }>(
            'select s.user_id,s.amount::text from public.recurring_expense_instances r join public.expense_splits s on s.expense_id=r.expense_id where r.recurring_id=$1 order by s.user_id',
            [rule],
          )
        ).rows.map((row) => [row.user_id, row.amount]);
      assert.deepEqual(await ledger(equal), [
        [alice, '500'],
        [bob, '500'],
      ]);
      assert.deepEqual(await ledger(percentage), [
        [alice, '400'],
        [bob, '600'],
      ]);
      assert.deepEqual(await ledger(custom), [
        [alice, '400'],
        [bob, '600'],
      ]);
      assert.deepEqual(await ledger(empty), []);
      assert.equal(
        await scalar('select active v from public.recurring_expenses where id=$1', [empty]),
        false,
      );
      const balances = await scalar('select public.expense_balances($1) v', [h]);
      await assert.rejects(
        db.query('select public.delete_recurring_expense($1,$2,2)', [h, equal]),
        /stale_version/,
      );
      await db.query('select public.delete_recurring_expense($1,$2,1)', [h, equal]);
      assert.equal(
        await scalar('select count(*)::int v from public.recurring_expenses where id=$1', [equal]),
        0,
      );
      assert.deepEqual(await scalar('select public.expense_balances($1) v', [h]), balances);
      // Advance the date read by the real generation job, leaving the rule cursors intact.
      await db.exec(`reset role; begin;
        create or replace function public.home_local_date(target uuid,at_instant timestamptz default now())
        returns date language sql stable set search_path='' as $$
          select (at_instant at time zone timezone)::date+7 from public.homes where id=target;
        $$;`);
      try {
        await as(alice);
        await db.query('select public.generate_recurring_expenses($1)', [h]);
        assert.equal(
          await scalar('select count(*)::int v from public.expenses where home_id=$1', [h]),
          5,
        );
        assert.equal(
          await scalar(
            "select count(*)::int v from public.recurring_expense_instances where recurring_id=any($1) and status='posted'",
            [[percentage, custom]],
          ),
          4,
        );
      } finally {
        await db.exec('rollback');
      }
    },
  );

  await t.test(
    '2641: private staging and final metadata are checked before the expense exists',
    async () => {
      const h = await home(2);
      const today = await date(h);
      const expense = randomUUID();
      const suffix = randomUUID() + '.pdf';
      const staging = `${h}/staging/${alice}/${suffix}`;
      const final = `${h}/${expense}/${alice}/${suffix}`;
      const put = (path: string, size: number) =>
        db.query(
          "insert into storage.objects(bucket_id,name,owner_id,metadata) values('expense-receipts',$1,$2,$3)",
          [path, alice, { mimetype: 'application/pdf', size }],
        );
      const save = (path: string) =>
        db.query('select public.save_expense_with_receipt($1,$2,0,$3,$4,false)', [
          h,
          expense,
          body(today, split([alice, bob])),
          path,
        ]);
      await put(staging, RECEIPT_MAX_BYTES);
      await as(bob);
      assert.equal(
        await scalar('select count(*)::int v from storage.objects where name=$1', [staging]),
        0,
      );
      await assert.rejects(put(final, RECEIPT_MAX_BYTES), /row-level security/);
      await as(alice);
      await assert.rejects(save(staging), /invalid_receipt/);
      const invalid = final.replace(suffix, randomUUID() + '.pdf');
      await put(invalid, RECEIPT_MAX_BYTES + 1);
      await assert.rejects(save(invalid), /invalid_receipt/);
      assert.equal(
        await scalar('select count(*)::int v from public.expenses where id=$1', [expense]),
        0,
      );
      await put(final, RECEIPT_MAX_BYTES);
      await save(final);
      await save(final);
      assert.equal(
        await scalar('select count(*)::int v from public.expenses where id=$1', [expense]),
        1,
      );
      assert.equal(
        await scalar('select size v from public.expense_attachments where expense_id=$1', [
          expense,
        ]),
        RECEIPT_MAX_BYTES,
      );
      assert.equal(
        (await db.query('delete from storage.objects where name=$1', [final])).affectedRows,
        0,
      );
      await as(bob);
      assert.equal(
        await scalar('select count(*)::int v from storage.objects where name=$1', [final]),
        1,
      );
      await as(outsider);
      assert.equal(
        await scalar('select count(*)::int v from storage.objects where name=$1', [final]),
        0,
      );
    },
  );
});
