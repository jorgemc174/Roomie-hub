import { receiptExtension } from '../src/features/expenses/receipts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { organizationDatabase } from './helpers/database';
import {
  parseDecimal,
  splitMoney,
  suggestPayments,
  currencyScale,
  formatMoney,
  inferCategory,
  MAX_MINOR,
} from '../src/features/expenses/money';
import type { ExpenseBody, Balance } from '../src/features/expenses/models';
test('exact money parsing, all currency scales and deterministic largest remainders', () => {
  assert.equal(parseDecimal('0.1', 2) + parseDecimal('0,2', 2), 30n);
  for (const bad of ['-1', '1e2', 'NaN', 'Infinity', '1.001', '1,000.00', ''])
    assert.throws(() => parseDecimal(bad, 2));
  assert.equal(parseDecimal('10000000000.00', 2), MAX_MINOR);
  assert.throws(() => parseDecimal('10000000000.01', 2));
  assert.equal(currencyScale('JPY'), 0);
  assert.equal(currencyScale('KWD'), 3);
  assert.equal(currencyScale('CLF'), 4);
  const a = [
    { user_id: 'a', weight: '1' },
    { user_id: 'b', weight: '1' },
    { user_id: 'c', weight: '1' },
  ];
  assert.deepEqual(
    splitMoney(1000n, 'equal', a).map((p) => p.amount),
    ['334', '333', '333'],
  );
  assert.deepEqual(splitMoney(1000n, 'equal', [...a].reverse()), splitMoney(1000n, 'equal', a));
  assert.deepEqual(
    splitMoney(101n, 'percentage', [
      { user_id: 'a', weight: '5000' },
      { user_id: 'b', weight: '3000' },
      { user_id: 'c', weight: '2000' },
    ]).map((p) => p.amount),
    ['51', '30', '20'],
  );
  assert.deepEqual(
    splitMoney(100n, 'custom', [
      { user_id: 'a', weight: '80' },
      { user_id: 'b', weight: '20' },
    ]).map((p) => p.amount),
    ['80', '20'],
  );
  assert.throws(() => splitMoney(100n, 'custom', a));
  assert.throws(() => splitMoney(100n, 'percentage', a));
  assert.throws(() => splitMoney(0n, 'equal', a));
  assert.equal(
    splitMoney(MAX_MINOR, 'equal', a).reduce((s, p) => s + BigInt(p.amount), 0n),
    MAX_MINOR,
  );
  assert.match(formatMoney('900719925474099312', 'EUR', 'en'), /9,007,199,254,740,993\.12/);
  assert.equal(inferCategory('Mercadona'), 'groceries');
  assert.equal(inferCategory('Netflix'), 'subscriptions');
  assert.equal(inferCategory('Alquiler septiembre'), 'rent');
  assert.equal(inferCategory('Iberdrola'), 'electricity');
  assert.equal(inferCategory('???'), 'other');
});
test('suggestions preserve each balance deterministically without inventing movements', () => {
  const b = [
    { user_id: 'a', balance: '4000' },
    { user_id: 'b', balance: '-1500' },
    { user_id: 'c', balance: '-2500' },
  ];
  const p = suggestPayments(b);
  assert.equal(p.length, 2);
  assert.deepEqual(p, suggestPayments([...b].reverse()));
  const settled = new Map(b.map((x) => [x.user_id, BigInt(x.balance)]));
  for (const x of p) {
    settled.set(x.from, settled.get(x.from)! + BigInt(x.amount));
    settled.set(x.to, settled.get(x.to)! - BigInt(x.amount));
  }
  assert.ok([...settled.values()].every((x) => x === 0n));
  assert.throws(() => suggestPayments([{ user_id: 'a', balance: '1' }]));
});
test('PostgreSQL finances, history, recurrences, isolation and receipts', async (t) => {
  const { db, home, users, as, scalar } = await organizationDatabase();
  const [a, b, c, out] = users;
  const body = (amount = '3000', participants = [a, b], mode = 'equal'): ExpenseBody => ({
    title: 'Cena',
    amount,
    date: '2026-09-15',
    payer: a,
    category: 'food',
    split_mode: mode as ExpenseBody['split_mode'],
    participants: participants.map((user_id) => ({ user_id, weight: '1' })),
  });
  const save = (h: string, id: string, p: ExpenseBody, v = 0) =>
    scalar<string>('select public.save_expense($1,$2,$3,$4) v', [h, id, v, p]);
  const balances = (h: string) => scalar<Balance[]>('select public.expense_balances($1) v', [h]);
  try {
    await t.test('equal split, payment, zero balances; payer may be excluded', async () => {
      const h = await home(3),
        id = randomUUID();
      await save(h, id, body());
      let rows = await balances(h);
      assert.equal(rows.find((x) => x.user_id === b)?.balance, '-1500');
      await as(b);
      await assert.rejects(
        db.query('select public.leave_home($1)', [h]),
        /outstanding_balance:-1500/,
      );
      await as(a);
      await assert.rejects(
        db.query('select public.leave_home($1)', [h]),
        /outstanding_balance:1500/,
      );
      const payment = randomUUID();
      await db.query('select public.record_settlement($1,$2,$3,$4,1500,$5)', [
        h,
        payment,
        b,
        a,
        '2026-09-15',
      ]);
      await db.query('select public.record_settlement($1,$2,$3,$4,1500,$5)', [
        h,
        payment,
        b,
        a,
        '2026-09-15',
      ]);
      assert.ok((await balances(h)).every((x) => x.balance === '0'));
      await save(h, randomUUID(), body('1000', [b, c]));
      rows = await balances(h);
      assert.equal(rows.find((x) => x.user_id === a)?.balance, '1000');
      assert.equal(rows.find((x) => x.user_id === b)?.balance, '-500');
      await assert.rejects(
        db.query('select public.record_settlement($1,$2,$3,$4,1,$5)', [
          h,
          payment,
          b,
          a,
          '2026-09-15',
        ]),
        /idempotency_conflict/,
      );
      await assert.rejects(
        db.query('select public.record_settlement($1,$2,$3,$3,1,$4)', [
          h,
          randomUUID(),
          a,
          '2026-09-15',
        ]),
        /invalid_payment/,
      );
      await assert.rejects(
        db.query('select public.record_settlement($1,$2,$3,$4,0,$5)', [
          h,
          randomUUID(),
          a,
          b,
          '2026-09-15',
        ]),
        /invalid_payment/,
      );
    });
    await t.test(
      'SQL/JS split parity, percentages, custom rejection and atomic edits',
      async () => {
        const h = await home(3);
        for (const total of [1n, 2n, 1000n, MAX_MINOR])
          for (const mode of ['equal', 'percentage'] as const) {
            const p = [a, b, c].map((user_id, i) => ({
              user_id,
              weight: ['5000', '3000', '2000'][i],
            }));
            const sql = await db.query<{ user_id: string; amount: number; weight: number }>(
              'select * from public.money_split($1,$2,$3)',
              [total.toString(), mode, p],
            );
            assert.deepEqual(
              sql.rows.map((r) => ({ ...r, amount: String(r.amount), weight: String(r.weight) })),
              splitMoney(total, mode, p),
            );
          }
        const id = randomUUID(),
          p = body('1000', [a, b], 'custom');
        p.participants[0].weight = '800';
        p.participants[1].weight = '200';
        await save(h, id, p);
        await save(h, id, p);
        assert.equal(
          await scalar('select count(*)::int v from public.expenses where id=$1', [id]),
          1,
        );
        await assert.rejects(save(h, id, { ...p, amount: '1001' }, 1), /invalid_split/);
        assert.equal(await scalar('select version v from public.expenses where id=$1', [id]), 1);
        await save(h, id, { ...p, title: 'Edited' }, 1);
        await assert.rejects(save(h, id, p, 1), /stale_version/);
        assert.equal(
          await scalar('select count(*)::int v from public.expense_events where expense_id=$1', [
            id,
          ]),
          2,
        );
        await db.query('select public.delete_expense($1,$2,2)', [h, id]);
        assert.ok((await balances(h)).every((x) => x.balance === '0'));
        assert.equal(
          await scalar('select count(*)::int v from public.expense_splits where expense_id=$1', [
            id,
          ]),
          2,
        );
        await assert.rejects(
          db.query('select public.update_home($1,$2,$3,null,1::smallint)', [h, 'Changed', 'USD']),
          /currency_has_history/,
        );
      },
    );
    await t.test(
      'former members retain snapshots, cannot be added, settle without general access',
      async () => {
        const h = await home(2),
          id = randomUUID();
        await save(h, id, body());
        await db.query('select public.record_settlement($1,$2,$3,$4,1500,$5)', [
          h,
          randomUUID(),
          b,
          a,
          '2026-09-15',
        ]);
        await as(b);
        await db.query('select public.leave_home($1)', [h]);
        assert.equal(
          await scalar('select count(*)::int v from public.expenses where home_id=$1', [h]),
          0,
        );
        await assert.rejects(balances(h), /unauthorized/);
        assert.deepEqual(await scalar('select public.my_departed_balance($1) v', [h]), {
          balance: '0',
          currency: 'EUR',
        });
        await as(a);
        await assert.rejects(save(h, randomUUID(), body()), /invalid_member/);
        assert.equal(
          await scalar(
            'select user_name v from public.expense_splits where expense_id=$1 and user_id=$2',
            [id, b],
          ),
          'Bob',
        );
        // An authorized historical correction may create a departed balance. Only active members record its settlement.
        await save(h, id, body('4000'), 1);
        await assert.rejects(
          db.query('select public.record_settlement($1,$2,$3,$4,501,$5)', [
            h,
            randomUUID(),
            b,
            a,
            '2026-09-15',
          ]),
          /former_payment_limit/,
        );
        await db.query('select public.record_settlement($1,$2,$3,$4,500,$5)', [
          h,
          randomUUID(),
          b,
          a,
          '2026-09-15',
        ]);
        assert.ok((await balances(h)).every((x) => x.balance === '0'));
      },
    );
    await t.test(
      'fixed, variable, monthly anchor, timezone and repeated confirmations',
      async () => {
        const h = await home(2);
        await db.query("select public.update_home_timezone($1,'Asia/Tokyo')", [h]);
        const today = await scalar<string>('select public.home_local_date($1)::text v', [h]);
        assert.equal(
          await scalar("select public.expense_occurrence('2024-01-31','monthly',1,1)::text v"),
          '2024-02-29',
        );
        assert.equal(
          await scalar("select public.expense_occurrence('2024-01-31','monthly',1,2)::text v"),
          '2024-03-31',
        );
        assert.equal(
          await scalar("select public.expense_occurrence('2024-01-31','monthly',3,1)::text v"),
          '2024-04-30',
        );
        const fixed = randomUUID(),
          variable = randomUUID();
        for (const [id, kind] of [
          [fixed, 'fixed'],
          [variable, 'variable'],
        ])
          await db.query(
            "select public.save_recurring_expense($1,$2,0,$3,$4,'monthly',1,$5,true)",
            [h, id, body(), kind, today],
          );
        await db.query('select public.generate_recurring_expenses($1)', [h]);
        await db.query('select public.generate_recurring_expenses($1)', [h]);
        assert.equal(
          await scalar('select count(*)::int v from public.expenses where home_id=$1', [h]),
          1,
        );
        assert.equal(
          await scalar(
            'select count(*)::int v from public.recurring_expense_instances where home_id=$1',
            [h],
          ),
          2,
        );
        const pending = await scalar<string>(
          "select id v from public.recurring_expense_instances where recurring_id=$1 and status='pending'",
          [variable],
        );
        await db.query('select public.confirm_recurring_expense($1,$2,$3)', [
          h,
          pending,
          body('4500'),
        ]);
        await db.query('select public.confirm_recurring_expense($1,$2,$3)', [
          h,
          pending,
          body('4500'),
        ]);
        assert.equal(
          await scalar('select count(*)::int v from public.expenses where home_id=$1', [h]),
          2,
        );
        await as(out);
        await assert.rejects(
          db.query('select public.confirm_recurring_expense($1,$2,$3)', [h, pending, body()]),
          /unauthorized/,
        );
      },
    );
    await t.test('completed shopping converts exactly once, products stay intact', async () => {
      const h = await home(2);
      const list = await scalar<string>(
        "select public.shopping_command($1,'create_list',null,null,'Mercadona') v",
        [h],
      );
      await db.query("select public.shopping_command($1,'add_item',$2,null,'Pan')", [h, list]);
      const p = { ...body(), shopping_list_id: list },
        id = randomUUID();
      await assert.rejects(save(h, id, p), /list_not_complete/);
      await db.query("select public.shopping_command($1,'complete_list',$2)", [h, list]);
      await save(h, id, p);
      await assert.rejects(save(h, randomUUID(), p), /list_already_linked/);
      assert.equal(
        await scalar(
          'select expense_id v from public.shopping_list_expense_links where shopping_list_id=$1',
          [list],
        ),
        id,
      );
      assert.equal(
        await scalar('select purchased v from public.shopping_items where shopping_list_id=$1', [
          list,
        ]),
        true,
      );
    });
    await t.test(
      'recurring snapshots, disabled templates, future dates and SQL invariants',
      async () => {
        const h = await home(2),
          today = await scalar<string>('select public.home_local_date($1)::text v', [h]),
          r = randomUUID();
        await db.query(
          "select public.save_recurring_expense($1,$2,0,$3,'variable','weekly',1,$4,true)",
          [h, r, body(), today],
        );
        await db.query('select public.generate_recurring_expenses($1)', [h]);
        assert.equal(
          await scalar(
            "select template->>'amount' v from public.recurring_expense_instances where recurring_id=$1",
            [r],
          ),
          '',
        );
        await db.query(
          "select public.save_recurring_expense($1,$2,1,$3,'variable','weekly',1,$4,false)",
          [h, r, { ...body(), title: 'Changed' }, today],
        );
        assert.equal(
          await scalar(
            "select template->>'title' v from public.recurring_expense_instances where recurring_id=$1",
            [r],
          ),
          'Cena',
        );
        const future = await scalar<string>('select (public.home_local_date($1)+1)::text v', [h]),
          fixed = randomUUID();
        await db.query(
          "select public.save_recurring_expense($1,$2,0,$3,'fixed','monthly',1,$4,true)",
          [h, fixed, body(), future],
        );
        await db.query('select public.generate_recurring_expenses($1)', [h]);
        assert.equal(
          await scalar('select count(*)::int v from public.expenses where home_id=$1', [h]),
          0,
        );
        const id = randomUUID();
        await save(h, id, body());
        await assert.rejects(
          save(h, id, { ...body(), title: 'Different request' }),
          /idempotency_conflict/,
        );
        await db.exec('reset role');
        await assert.rejects(
          db.query('update public.expense_splits set amount=1 where expense_id=$1', [id]),
          /invalid_split_total/,
        );
        await as(a);
        await assert.rejects(
          db.query('select public.record_settlement($1,$2,$3,$4,1,$5)', [
            h,
            randomUUID(),
            a,
            out,
            today,
          ]),
          /invalid_member/,
        );
        const other = await home(1);
        await assert.rejects(save(other, id, body(), 1), /not_found/);
        await assert.rejects(
          db.query('select public.delete_expense($1,$2,1)', [other, id]),
          /not_found/,
        );
      },
    );
    await t.test(
      'recurrence uses home day across midnight and departure reconciles current tasks',
      async () => {
        const h = await home(2);
        await db.query("select public.update_home_timezone($1,'Pacific/Kiritimati')", [h]);
        const later = await scalar<string>('select public.home_local_date($1)::text v', [h]);
        await db.query("select public.update_home_timezone($1,'Etc/GMT+12')", [h]);
        const earlier = await scalar<string>('select public.home_local_date($1)::text v', [h]);
        assert.ok(earlier < later);
        await db.query(
          "select public.save_recurring_expense($1,$2,0,$3,'fixed','monthly',1,$4,true)",
          [h, randomUUID(), body(), later],
        );
        await db.query('select public.generate_recurring_expenses($1)', [h]);
        assert.equal(
          await scalar('select count(*)::int v from public.expenses where home_id=$1', [h]),
          0,
        );
        await db.query("select public.update_home_timezone($1,'Pacific/Kiritimati')", [h]);
        await db.query('select public.generate_recurring_expenses($1)', [h]);
        assert.equal(
          await scalar('select expense_date::text v from public.expenses where home_id=$1', [h]),
          later,
        );
        const h2 = await home(2),
          today = await scalar<string>('select public.home_local_date($1)::text v', [h2]);
        await db.query(
          "select public.save_chore($1,null,'Kitchen','',2,true,'daily',1,$2,'manual',$3,null,'20:00','UTC')",
          [h2, today, [b, a]],
        );
        await db.query('select public.ensure_current_chores($1)', [h2]);
        assert.equal(
          await scalar(
            'select assignee_id v from public.chore_instances where home_id=$1 and period_start=$2',
            [h2, today],
          ),
          b,
        );
        await as(b);
        await db.query('select public.leave_home($1)', [h2]);
        await as(a);
        assert.equal(
          await scalar(
            'select assignee_id v from public.chore_instances where home_id=$1 and period_start=$2',
            [h2, today],
          ),
          a,
        );
      },
    );
    await t.test(
      'RLS, anonymous access, cross-home RPCs, private receipt access and helper ACL',
      async () => {
        const h = await home(2),
          id = randomUUID();
        await save(h, id, body());
        const path = `${h}/${id}/${randomUUID()}.pdf`;
        await db.query(
          "insert into storage.objects(bucket_id,name) values('expense-receipts',$1)",
          [path],
        );
        await db.query("select public.attach_expense_receipt($1,$2,$3,'application/pdf',100)", [
          h,
          id,
          path,
        ]);
        const tables = [
          'expenses',
          'expense_splits',
          'expense_events',
          'settlements',
          'recurring_expenses',
          'recurring_expense_instances',
          'shopping_list_expense_links',
          'expense_attachments',
        ];
        await assert.rejects(
          db.query('update public.expenses set amount=1 where id=$1', [id]),
          /permission denied/,
        );
        await assert.rejects(
          db.query('select * from public.finance_balances($1)', [h]),
          /permission denied/,
        );
        await as(out);
        for (const table of tables)
          assert.equal(
            await scalar(`select count(*)::int v from public.${table} where home_id=$1`, [h]),
            0,
          );
        assert.equal(
          await scalar(
            "select count(*)::int v from storage.objects where bucket_id='expense-receipts' and name=$1",
            [path],
          ),
          0,
        );
        await assert.rejects(save(h, randomUUID(), body()), /unauthorized/);
        await assert.rejects(
          db.query('select public.delete_expense($1,$2,1)', [h, id]),
          /unauthorized/,
        );
        await assert.rejects(
          db.query('select public.my_departed_balance($1)', [h]),
          /unauthorized/,
        );
        await db.exec('reset role; set role anon');
        await assert.rejects(balances(h), /permission denied/);
        await db.exec('reset role');
      },
    );
  } finally {
    await db.close();
  }
});

test('receipt signatures, type and size must agree', () => {
  const pdf = new TextEncoder().encode('%PDF-1.7');
  assert.equal(receiptExtension('application/pdf', 100, pdf), 'pdf');
  assert.equal(receiptExtension('application/pdf', 10485761, pdf), null);
  assert.equal(receiptExtension('application/x-msdownload', 100, pdf), null);
  assert.equal(receiptExtension('image/png', 100, pdf), null);
  assert.equal(receiptExtension('application/pdf', 100, new TextEncoder().encode('MZexe')), null);
});
