import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { summarizeCategories } from '../src/features/expenses/money';
import { organizationDatabase } from './helpers/database';

test('category totals stay exact beyond Number limits; percentages sum to 100 with stable ties', () => {
  const rows = [
    { category: 'food' as const, amount: '9007199254740993' },
    { category: 'rent' as const, amount: '9007199254740993' },
    { category: 'other' as const, amount: '9007199254740993' },
  ];
  const summary = summarizeCategories(rows);
  assert.equal(summary.total, 27021597764222979n);
  assert.deepEqual(
    summary.categories.map((c) => [c.category, c.basisPoints]),
    [
      ['food', 3334n],
      ['other', 3333n],
      ['rent', 3333n],
    ],
  );
  assert.deepEqual(summarizeCategories([...rows].reverse()), summary);
  assert.deepEqual(summarizeCategories([]), { total: 0n, categories: [] });
  const aggregate = summarizeCategories([
    { category: 'food', amount: 1 },
    { category: 'rent', amount: 7 },
    { category: 'food', amount: 2 },
  ]);
  assert.deepEqual(aggregate.categories, [
    { category: 'rent', amount: 7n, basisPoints: 7000n },
    { category: 'food', amount: 3n, basisPoints: 3000n },
  ]);
});

test('expense activity combines revisions and payments in globally paginated order under RLS', async () => {
  const { db, home, users, as } = await organizationDatabase();
  try {
    const h = await home(2);
    const other = await home(1);
    await as(users[0]);
    const id = randomUUID();
    const body = {
      title: 'Dinner',
      amount: '1000',
      date: '2026-11-01',
      payer: users[0],
      category: 'food',
      split_mode: 'equal',
      participants: users.slice(0, 2).map((user_id) => ({ user_id, weight: '1' })),
    };
    await db.query('select public.save_expense($1,$2,0,$3)', [h, id, body]);
    await db.query('select public.record_settlement($1,$2,$3,$4,500,$5)', [
      h,
      randomUUID(),
      users[1],
      users[0],
      '2026-10-31',
    ]);
    await db.query('select public.save_expense($1,$2,1,$3)', [
      h,
      id,
      { ...body, title: 'Dinner edited' },
    ]);
    await db.exec('reset role');
    await db.query(
      "update public.expense_events set recorded_at = case when revision=1 then '2026-11-01T10:00Z'::timestamptz else '2026-11-01T12:00Z'::timestamptz end where home_id=$1",
      [h],
    );
    await db.query(
      "update public.settlements set created_at='2026-11-01T11:00Z' where home_id=$1",
      [h],
    );
    await as(users[0]);
    const read = async (target: string, page: number) =>
      (
        await db.query<{
          id: string;
          kind: string;
          recorded_at: Date;
          payload: { title?: string; from_name?: string };
        }>('select * from public.expense_activity($1,$2)', [target, page])
      ).rows;
    const rows = await read(h, 0);
    assert.deepEqual(
      rows.map((r) => r.kind),
      ['revision', 'payment', 'revision'],
    );
    assert.equal(rows[1].payload.from_name, 'Bob');
    assert.equal(new Date(rows[1].recorded_at).toISOString(), '2026-11-01T11:00:00.000Z');
    assert.deepEqual(await read(h, 1), []);
    // Exercise multiple mixed pages, including equal timestamps. Pagination must
    // happen after the union, with a stable tie-break and no omissions/duplicates.
    await db.exec('reset role');
    await db.query(
      `insert into public.settlements(id,home_id,from_user,to_user,from_name,to_name,amount,currency,payment_date,created_by,created_by_name,created_at)
      select gen_random_uuid(),$1,$2,$3,'Bob','Alice',1,'EUR','2026-10-31',$3,'Alice',
        '2026-11-01T11:00Z'::timestamptz from generate_series(1,104)`,
      [h, users[1], users[0]],
    );
    await as(users[0]);
    const pages = [await read(h, 0), await read(h, 1), await read(h, 2)];
    assert.deepEqual(
      pages.map((p) => p.length),
      [50, 50, 7],
    );
    const all = pages.flat();
    assert.equal(new Set(all.map((r) => r.kind + r.id)).size, 107);
    assert.equal(all[0].kind, 'revision');
    assert.equal(all.at(-1)?.kind, 'revision');
    assert.deepEqual(await read(h, 0), pages[0]);
    assert.deepEqual(await read(h, 3), []);
    const totals = async (target: string, category: string | null = null) =>
      (
        await db.query<{ category: string; amount: string }>(
          'select * from public.expense_category_totals($1,$2) order by category',
          [target, category],
        )
      ).rows;
    assert.deepEqual(await totals(h), [{ category: 'food', amount: '1000' }]);
    assert.deepEqual(await totals(h, 'rent'), []);
    // Aggregation covers the entire filtered ledger, independently of page size.
    await db.query(
      'select public.save_expense($1,gen_random_uuid(),0,$2) from generate_series(1,60)',
      [h, { ...body, title: 'Rent', category: 'rent', amount: '1000000000000' }],
    );
    assert.deepEqual(await totals(h, 'rent'), [{ category: 'rent', amount: '60000000000000' }]);
    assert.deepEqual(await totals(h), [
      { category: 'food', amount: '1000' },
      { category: 'rent', amount: '60000000000000' },
    ]);
    await as(users[3]);
    assert.deepEqual(await totals(h), []);
    assert.deepEqual(await read(h, 0), []);
    await as(users[1]);
    assert.deepEqual(await read(other, 0), []);
    await db.exec('set role anon');
    await assert.rejects(read(h, 0), /permission denied/);
  } finally {
    await db.close();
  }
});
