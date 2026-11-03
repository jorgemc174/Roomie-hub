import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDemoAccount,
  assertAccountContinuity,
  assertDemoHome,
  dateOffset,
  homes,
  namespace,
  people,
  stableId,
  seedHome,
} from '../scripts/seed-demo.mjs';
import { cleanupPlan } from '../scripts/cleanup-demo.mjs';
import { organizationDatabase } from './helpers/database.ts';

const demo = {
  id: 'demo-user',
  email: people[0].email,
  user_metadata: { demo: true, demo_seed: namespace },
};
test('a missing or replaced account from the manifest is rejected before creation', () => {
  assert.throws(() => assertAccountContinuity(undefined, demo));
  assert.throws(() => assertAccountContinuity({ ...demo, id: 'new-id' }, demo));
  assert.doesNotThrow(() => assertAccountContinuity(demo, demo));
  assert.doesNotThrow(() => assertAccountContinuity(undefined, undefined));
});
test('demo account guard rejects real, QA, prefix-only and differently owned accounts', () => {
  assert.doesNotThrow(() => assertDemoAccount(demo, people[0].email));
  for (const user of [
    null,
    { ...demo, email: 'rhqa@example.com' },
    { ...demo, email: 'demo.unknown@roomiehub-demo.test' },
    { ...demo, user_metadata: { demo: true } },
    { ...demo, user_metadata: { demo: false, demo_seed: namespace } },
  ])
    assert.throws(() => assertDemoAccount(user));
  assert.throws(() => assertDemoAccount(demo, people[1].email));
});
test('demo home guard rejects QA, empty membership and a real former member', () => {
  const home = { id: 'demo-home', name: homes[0].name },
    ids = new Set([demo.id]);
  assert.doesNotThrow(() => assertDemoHome(home, [{ user_id: demo.id, active: true }], ids));
  assert.throws(() => assertDemoHome({ ...home, name: 'QA' }, [{ user_id: demo.id }], ids));
  assert.throws(() => assertDemoHome(home, [], ids));
  assert.throws(() =>
    assertDemoHome(home, [{ user_id: demo.id }, { user_id: 'real-user', active: false }], ids),
  );
});
test('demo identities and dates remain deterministic across reruns, month and DST boundaries', () => {
  assert.equal(new Set(people.map((p) => p.email)).size, 16);
  assert.equal(new Set(homes.map((p) => p.name)).size, 5);
  assert.equal(stableId('same-operation'), stableId('same-operation'));
  assert.notEqual(stableId('same-operation'), stableId('other-operation'));
  assert.match(
    stableId('same-operation'),
    /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/,
  );
  assert.equal(dateOffset('2026-11-03', -55), '2026-09-09');
  assert.equal(dateOffset('2026-10-25', 1), '2026-10-26');
});
function fakeConfig({
  foreignMembership = false,
  foreignFormer = false,
  renamed = false,
  unknownUser = false,
} = {}) {
  const calls = [];
  const cfg = {
    admin: {
      auth: {
        admin: {
          listUsers: async () => ({
            data: { users: [unknownUser ? { ...demo, user_metadata: {} } : demo] },
          }),
        },
      },
      from(table) {
        calls.push(table);
        const filters = new Map();
        const q = {
          select() {
            return q;
          },
          eq(key, value) {
            filters.set(key, value);
            return q;
          },
          maybeSingle: async () => ({
            data: { id: 'demo-home', name: renamed ? 'Real home' : homes[0].name },
          }),
          then(resolve) {
            const data = filters.has('home_id')
              ? [
                  { user_id: demo.id, active: true },
                  ...(foreignFormer ? [{ user_id: 'real', active: false }] : []),
                ]
              : [{ home_id: foreignMembership ? 'real-home' : 'demo-home' }];
            return Promise.resolve({ data }).then(resolve);
          },
        };
        return q;
      },
      storage: { listBuckets: async () => ({ data: [] }) },
    },
  };
  return { cfg, calls };
}
const manifest = {
  users: [{ id: demo.id, email: demo.email }],
  homes: [{ id: 'demo-home', name: homes[0].name }],
};
test('cleanup planning is read-only and only returns explicitly owned demo records', async () => {
  const { cfg } = fakeConfig();
  const plan = await cleanupPlan(cfg, manifest);
  assert.equal(plan.accounts.length, 1);
  assert.equal(plan.targets.length, 1);
  assert.equal(plan.objects.length, 0);
});
test('cleanup aborts the entire plan if an account belongs to another home, including former membership', async () => {
  for (const options of [
    { foreignMembership: true },
    { foreignFormer: true },
    { renamed: true },
    { unknownUser: true },
  ]) {
    const { cfg } = fakeConfig(options);
    await assert.rejects(cleanupPlan(cfg, manifest));
  }
});

// Execute the actual seed against the actual migrations. Only Auth fixture setup uses SQL;
// all business writes below call the same public RPCs as the production script under RLS.
test('full seed uses real PostgreSQL contracts, resumes after a committed payment and does not duplicate', async () => {
  const { db, as } = await organizationDatabase();
  try {
    const accounts = [];
    for (const [index, person] of people.entries()) {
      const id = stableId(`local-user-${index}`);
      await db.exec('reset role');
      await db.query('insert into auth.users values($1,$2)', [
        id,
        JSON.stringify({ name: person.name }),
      ]);
      const c = {
        async rpc(name, args) {
          await as(id);
          try {
            const keys = Object.keys(args);
            const sql = `select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(',')}) as value`;
            const params = Object.values(args).map((v) =>
              v && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v,
            );
            const data = (await db.query(sql, params)).rows[0].value;
            return { data, error: null };
          } catch (e) {
            return { data: null, error: { code: `${e.code}:${e.message}` } };
          }
        },
        from(table) {
          let columns = '*';
          const filters = [],
            order = [];
          const q = {
            select(value) {
              columns = value;
              return q;
            },
            eq(key, value) {
              filters.push([key, value]);
              return q;
            },
            order(key) {
              order.push(key);
              return q;
            },
            async then(resolve) {
              await as(id);
              const sql = `select ${columns} from public.${table}${filters.length ? ' where ' + filters.map(([k], i) => `${k}=$${i + 1}`).join(' and ') : ''}${order.length ? ' order by ' + order.join(',') : ''}`;
              try {
                // Match PostgREST's JSON transport instead of PGlite Date objects.
                const rows = (
                  await db.query(
                    sql,
                    filters.map(([, v]) => v),
                  )
                ).rows;
                return resolve({
                  data: JSON.parse(
                    JSON.stringify(rows, (_, v) => (typeof v === 'bigint' ? String(v) : v)),
                  ),
                });
              } catch (e) {
                return resolve({ error: { code: e.code } });
              }
            },
            async single() {
              const r = await q;
              return { ...r, data: r.data?.[0] };
            },
          };
          return q;
        },
      };
      accounts.push({ ...person, id, c });
    }
    const definition = homes[0];
    const h = (
      await accounts[0].c.rpc('create_home', { home_name: definition.name, home_currency: 'EUR' })
    ).data;
    const home = { id: h, name: definition.name };
    await as(accounts[0].id);
    const day = (await db.query('select public.home_local_date($1)::text as day', [h])).rows[0].day;
    let persisted = { day, done: {} },
      interruption = 'variable';
    // Crash once after confirming a variable invoice, then once after a payment commits.
    const persist = async (state) => {
      if (
        (interruption === 'variable' && Object.hasOwn(state.done, h + ':confirm-variable')) ||
        (interruption === 'payment' &&
          Object.keys(state.done).some(
            (k) => k.startsWith(h + ':payment-') && !k.endsWith(':payment-plan'),
          ))
      ) {
        interruption = interruption === 'variable' ? 'payment' : 'done';
        throw new Error('simulated interruption');
      }
      persisted = structuredClone(state);
    };
    await assert.rejects(
      seedHome(structuredClone(persisted), definition, home, accounts, persist),
      /simulated interruption/,
    );
    assert.equal(interruption, 'payment');
    await assert.rejects(
      seedHome(structuredClone(persisted), definition, home, accounts, persist),
      /simulated interruption/,
    );
    assert.equal(interruption, 'done');
    const state = structuredClone(persisted);
    await seedHome(state, definition, home, accounts, async (s) => {
      persisted = structuredClone(s);
    });
    await db.exec('reset role');
    const counts = async () => {
      await db.exec('reset role');
      return (
        await db.query(
          `select (select count(*) from public.expenses where home_id=$1) expenses,
        (select count(*) from public.settlements where home_id=$1) payments,
        (select count(*) from public.chore_instances where home_id=$1) chores,
        (select count(*) from public.chat_messages where home_id=$1) messages,
        (select count(*) from public.notifications where home_id=$1) notices`,
          [h],
        )
      ).rows[0];
    };
    const before = await counts();
    assert.ok(Number(before.expenses) >= 24);
    assert.ok(Number(before.chores) > 60);
    assert.ok(
      Number(
        (
          await db.query(
            'select count(*) n from public.chore_instances where home_id=$1 and completed_at is not null',
            [h],
          )
        ).rows[0].n,
      ) > 50,
    );
    assert.equal(Number(before.messages), 20);
    assert.ok(Number(before.notices) > 0);
    await seedHome(state, definition, home, accounts, async () => {});
    assert.deepEqual(await counts(), before);
    assert.equal(
      Number(
        (
          await db.query(
            'select count(distinct category) n from public.expenses where home_id=$1',
            [h],
          )
        ).rows[0].n,
      ),
      12,
    );
    assert.equal(
      (
        await db.query('select active from public.home_members where home_id=$1 and user_id=$2', [
          h,
          accounts[4].id,
        ])
      ).rows[0].active,
      false,
    );
    const historicalBalance = (await accounts[4].c.rpc('my_departed_balance', { target: h })).data;
    assert.equal(historicalBalance.balance, '-300');
    // Check the remaining floor sizes, shared member, real dates and two-person splits too.
    for (const other of homes.slice(1)) {
      const actor = accounts[other.members[0]];
      const otherId = (
        await actor.c.rpc('create_home', { home_name: other.name, home_currency: 'EUR' })
      ).data;
      const otherState = { day, done: {} };
      await seedHome(
        otherState,
        other,
        { id: otherId, name: other.name },
        accounts,
        async () => {},
      );
      await db.exec('reset role');
      assert.equal(
        Number(
          (
            await db.query('select count(*) n from public.chat_messages where home_id=$1', [
              otherId,
            ])
          ).rows[0].n,
        ),
        20,
      );
      assert.equal(
        Number(
          (
            await db.query(
              'select count(distinct category) n from public.expenses where home_id=$1',
              [otherId],
            )
          ).rows[0].n,
        ),
        12,
      );
    }
  } finally {
    await db.close();
  }
});
