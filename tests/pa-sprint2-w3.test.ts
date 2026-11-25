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
      const next = (
        await db.query<{ id: string; assignee_id: string }>(
          'select id,assignee_id from public.chore_instances where chore_id=$1 and period_start=$2',
          [task, first.ends],
        )
      ).rows[0];
      assert.equal(next.assignee_id, bob);
      await db.exec('reset role');
      const notices = () =>
        scalar<number>(
          "select count(*)::int v from public.notifications where source_id=$1 and user_id=$2 and event_type='task_assigned'",
          [next.id, bob],
        );
      const tick = (offset: string) =>
        db.query(
          'select messaging_private.remind_home(h.id,($2::date::timestamp at time zone h.timezone)+$3::interval) from public.homes h where h.id=$1',
          [h, first.ends, offset],
        );
      await tick('-1 second');
      assert.equal(await notices(), 0);
      await tick('0 seconds');
      await tick('1 minute');
      assert.equal(await notices(), 1);
      await as(alice);
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
      const put = (path: string, metadata: object, owner = alice) =>
        db.query(
          "insert into storage.objects(bucket_id,name,owner_id,metadata) values('expense-receipts',$1,$2,$3)",
          [path, owner, metadata],
        );
      const pdf = (size: number) => ({ mimetype: 'application/pdf', size });
      const save = (path: string) =>
        db.query('select public.save_expense_with_receipt($1,$2,0,$3,$4,false)', [
          h,
          expense,
          body(today, split([alice, bob])),
          path,
        ]);
      await put(staging, pdf(RECEIPT_MAX_BYTES));
      await as(bob);
      assert.equal(
        await scalar('select count(*)::int v from storage.objects where name=$1', [staging]),
        0,
      );
      await assert.rejects(put(final, pdf(RECEIPT_MAX_BYTES)), /row-level security/);
      await as(alice);
      await assert.rejects(save(staging), /invalid_receipt/);
      for (const metadata of [
        pdf(RECEIPT_MAX_BYTES + 1),
        pdf(1.5),
        { mimetype: 'application/pdf' },
        { ...pdf(100), mimetype: 'image/png' },
      ]) {
        const invalid = final.replace(suffix, randomUUID() + '.pdf');
        await put(invalid, metadata);
        await assert.rejects(save(invalid), /invalid_receipt/);
      }
      const foreign = final.replace(suffix, randomUUID() + '.pdf');
      await put(foreign, pdf(100), bob);
      await assert.rejects(save(foreign), /invalid_receipt/);
      assert.equal(
        await scalar('select count(*)::int v from public.expenses where id=$1', [expense]),
        0,
      );
      await put(final, {
        mimetype: 'Application/PDF; charset=binary',
        contentLength: String(RECEIPT_MAX_BYTES),
      });
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

  await t.test(
    'replaying an expense with a new receipt path keeps only the original attachment',
    async () => {
      const h = await home(2);
      const expense = randomUUID();
      const payload = body(await date(h), split([alice, bob]));
      const paths = Array.from({ length: 3 }, () => `${h}/${expense}/${alice}/${randomUUID()}.pdf`);
      const [original, retry, edit] = paths;
      for (const path of paths) {
        await db.query(
          "insert into storage.objects(bucket_id,name,owner_id,metadata) values('expense-receipts',$1,$2,$3)",
          [path, alice, { mimetype: 'application/pdf', size: 100 }],
        );
      }
      const save = (path: string, version = 0, data = payload) =>
        scalar<string>('select public.save_expense_with_receipt($1,$2,$3,$4,$5,false) v', [
          h,
          expense,
          version,
          data,
          path,
        ]);
      const attachments = async () =>
        (
          await db.query<{ path: string }>(
            'select path from public.expense_attachments where expense_id=$1 order by path',
            [expense],
          )
        ).rows.map(({ path }) => path);

      assert.equal(await save(original), expense);
      assert.deepEqual(await attachments(), [original]);
      assert.equal(await save(retry), expense);
      assert.deepEqual(await attachments(), [original]);
      assert.equal(await save(edit, 1, { ...payload, amount: '1500' }), expense);
      assert.deepEqual(await attachments(), [original, edit].sort());
      assert.equal(await scalar('select version v from public.expenses where id=$1', [expense]), 2);
    },
  );

  await t.test(
    'receipt cleanup reserves only expired orphans and retries unacknowledged deletions',
    async () => {
      const h = await home(2);
      const expense = randomUUID();
      const final = (id: string) => `${h}/${id}/${alice}/${randomUUID()}.pdf`;
      const attached = final(expense);
      const abandonedExpense = randomUUID();
      const orphan = final(abandonedExpense);
      const staging = `${h}/staging/${alice}/${randomUUID()}.pdf`;
      const fresh = final(randomUUID());
      const put = (path: string, bucket = 'expense-receipts') =>
        db.query(
          'insert into storage.objects(bucket_id,name,owner_id,metadata) values($1,$2,$3,$4)',
          [bucket, path, alice, { mimetype: 'application/pdf', size: 100 }],
        );
      const save = async (id: string, path: string) =>
        db.query('select public.save_expense_with_receipt($1,$2,0,$3,$4,false)', [
          h,
          id,
          body(await date(h), split([alice, bob])),
          path,
        ]);
      await put(attached);
      await save(expense, attached);
      const claim = () =>
        db.query<{ path: string; lease: string }>('select * from public.claim_receipt_cleanup()');
      await assert.rejects(claim(), /permission denied/);
      await db.exec('reset role');
      for (const path of [orphan, staging, fresh]) await put(path);
      await put(staging, 'avatars');
      await db.query(
        "update storage.objects set created_at=now()-interval '25 hours' where name=any($1)",
        [[attached, orphan, staging]],
      );
      await db.exec('set role service_role');
      const first = (await claim()).rows;
      assert.deepEqual(first.map((r) => r.path).sort(), [orphan, staging].sort());
      assert.equal((await claim()).rows.length, 0);
      await as(alice);
      await assert.rejects(save(abandonedExpense, orphan), /invalid_receipt/);
      await db.exec('reset role');
      await db.exec(
        "update messaging_private.receipt_cleanup set leased_at=now()-interval '6 minutes'; set role service_role",
      );
      const retry = (await claim()).rows;
      assert.deepEqual(retry.map((r) => r.path).sort(), [orphan, staging].sort());
      assert.notEqual(retry[0].lease, first[0].lease);
      await db.query('select finish_receipt_cleanup($1)', [first[0].lease]);
      await db.exec('reset role');
      assert.equal(
        await scalar('select count(*)::int v from messaging_private.receipt_cleanup'),
        2,
      );
      await db.query(
        "delete from storage.objects where bucket_id='expense-receipts' and name=any($1)",
        [[orphan, staging]],
      );
      await db.exec('set role service_role');
      await db.query('select finish_receipt_cleanup($1)', [retry[0].lease]);
      assert.equal((await claim()).rows.length, 0);
      await db.exec('reset role');
      assert.equal(
        await scalar('select count(*)::int v from messaging_private.receipt_cleanup'),
        0,
      );
      assert.equal(
        await scalar('select count(*)::int v from storage.objects where name=$1', [attached]),
        1,
      );
      assert.equal(
        await scalar(
          "select count(*)::int v from storage.objects where bucket_id='avatars' and name=$1",
          [staging],
        ),
        1,
      );
    },
  );
});
