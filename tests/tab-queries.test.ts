import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readOrganizationRows } from '../src/features/organization/queries';
import { readCommunityRows } from '../src/features/community/queries';

// Query transport spy only: verifies which reads execute, scoping, pagination and
// failures. No application session or remote database is replaced by these tests.
function transport(options: { fail?: string; large?: string } = {}) {
  const reads: { table: string; range: number[]; filters: unknown[][] }[] = [];
  const db = {
    from(table: string) {
      const filters: unknown[][] = [];
      const query = {
        select(...args: unknown[]) {
          filters.push(['select', ...args]);
          return query;
        },
        eq(...args: unknown[]) {
          filters.push(['eq', ...args]);
          return query;
        },
        or(...args: unknown[]) {
          filters.push(['or', ...args]);
          return query;
        },
        lte(...args: unknown[]) {
          filters.push(['lte', ...args]);
          return query;
        },
        gte(...args: unknown[]) {
          filters.push(['gte', ...args]);
          return query;
        },
        is(...args: unknown[]) {
          filters.push(['is', ...args]);
          return query;
        },
        order(...args: unknown[]) {
          filters.push(['order', ...args]);
          return query;
        },
        async range(from: number, to: number) {
          reads.push({ table, range: [from, to], filters: [...filters] });
          if (options.fail === table)
            return { data: null, error: { code: 'test', message: 'read failed' } };
          const size = options.large === table ? 502 : 1;
          return {
            data: Array.from({ length: Math.max(0, Math.min(to + 1, size) - from) }, (_, i) => ({
              id: `${table}-${from + i}`,
            })),
            error: null,
          };
        },
      };
      return query;
    },
  };
  return { reads, db: db as unknown as Parameters<typeof readOrganizationRows>[0] };
}

test('organization reads only visible tab data while keeping all reads scoped to the home', async () => {
  const expected = {
    tasks: ['chores', 'chore_rotation_members', 'chore_instances', 'chore_assignment_events'],
    shopping: ['shopping_lists', 'shopping_items'],
    absences: ['absences'],
  };
  for (const tab of ['tasks', 'shopping', 'absences'] as const) {
    const { db, reads } = transport();
    await readOrganizationRows(db, 'home-example', tab, '2026-10-01', '2026-10-31');
    assert.deepEqual(
      reads.map((r) => r.table),
      expected[tab],
    );
    for (const r of reads)
      assert.ok(r.filters.some((f) => JSON.stringify(f) === '["eq","home_id","home-example"]'));
    if (tab === 'tasks') {
      const task = reads.find((r) => r.table === 'chore_instances')!;
      assert.ok(
        task.filters.some(
          (f) => f[0] === 'or' && f[1] === 'period_end.gt.2026-10-01,completed_at.is.null',
        ),
      );
      assert.ok(
        task.filters.some(
          (f) => f[0] === 'lte' && f[1] === 'period_start' && f[2] === '2026-10-31',
        ),
      );
    }
  }
});

test('visible organization data remains fully paginated and reports actual read errors', async () => {
  const { db, reads } = transport({ large: 'shopping_items', fail: 'chores' });
  const shopping = await readOrganizationRows(
    db,
    'home-example',
    'shopping',
    '2026-10-01',
    '2026-10-31',
  );
  assert.equal(shopping.items.data?.length, 502);
  assert.equal(shopping.items.error, null);
  assert.deepEqual(
    reads.filter((r) => r.table === 'shopping_items').map((r) => r.range),
    [
      [0, 499],
      [500, 999],
    ],
  );
  const tasks = await readOrganizationRows(db, 'home-example', 'tasks', '2026-10-01', '2026-10-31');
  assert.equal(tasks.chores.error?.code, 'test');
});

test('community avoids unrelated histories and keeps home scoping', async () => {
  const expected = {
    points: ['rating_reasons', 'rating_redemptions'],
    punishments: ['punishments'],
    ranking: [],
    reasons: ['rating_reasons'],
  };
  for (const tab of ['points', 'punishments', 'ranking', 'reasons'] as const) {
    const { db, reads } = transport({ fail: tab === 'ranking' ? 'punishments' : undefined });
    await readCommunityRows(db, 'home-example', tab);
    assert.deepEqual(
      reads.map((r) => r.table),
      expected[tab],
    );
    for (const r of reads)
      assert.ok(
        r.filters.some((f) => f[0] === 'eq' && f[1] === 'home_id' && f[2] === 'home-example'),
      );
  }
});

test('community preserves pagination and surfaces failures in the selected view', async () => {
  const { db } = transport({ large: 'punishments', fail: 'rating_reasons' });
  const result = await readCommunityRows(db, 'home-example', 'punishments');
  assert.equal(result.punishments.length, 502);
  await assert.rejects(readCommunityRows(db, 'home-example', 'reasons'), {
    code: 'test',
    message: 'read failed',
  });
});
