import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { organizationDatabase } from './helpers/database';
import { serverModule } from './helpers/server-module';
import * as logic from '../src/features/organization/logic';
import { organizationMessages } from '../src/features/organization/messages';
import { TaskList } from '../src/features/organization/task-list';
import type { ChoreInstance } from '../src/features/organization/models';

const homeId = '11111111-1111-4111-8111-111111111110';
const person = '22222222-2222-4222-8222-222222222222';
const es = organizationMessages('es');

type Absence = { id: string; start_date: string; end_date: string };
// Minimal Supabase double: records RPCs and filters absences like the real query.
function fakeDb(absences: Absence[], rpcError: { message: string; code?: string } | null = null) {
  const calls: string[] = [];
  const db = {
    rpc: async (name: string) => {
      calls.push(name);
      return { data: null, error: rpcError };
    },
    from: () => {
      let rows = absences;
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        lte: (_: string, v: string) => ((rows = rows.filter((r) => r.start_date <= v)), chain),
        gte: (_: string, v: string) => ((rows = rows.filter((r) => r.end_date >= v)), chain),
        then: (resolve: (value: { data: Absence[]; error: null }) => void) =>
          resolve({ data: rows, error: null }),
      };
      return chain;
    },
  };
  return { db, calls };
}
async function action(db: unknown) {
  const mod = await serverModule<{
    organizationAction: (
      home: string,
      operation: string,
      state: object,
      form: FormData,
    ) => Promise<{ error?: string; success?: string }>;
  }>('src/features/organization/actions.ts', {
    'next/cache': { revalidatePath: () => undefined },
    'next/navigation': { redirect: () => undefined, unstable_rethrow: () => undefined },
    '@/lib/data': { requireUser: async () => ({ db }) },
    '@/lib/i18n/server': { i18n: async () => ({ locale: 'es' }) },
    './messages': { organizationMessages },
    './logic': logic,
  });
  return mod.organizationAction;
}
const form = (values: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
};
const absence = (start: string, end: string, id = '') =>
  form({ id, person, start_date: start, end_date: end });

test('PA 2406: an end date before the start shows the specific message and saves nothing', async () => {
  const { db, calls } = fakeDb([]);
  const run = await action(db);
  const result = await run(homeId, 'save_absence', {}, absence('2026-12-15', '2026-12-10'));
  assert.equal(result.error, 'La fecha de fin no puede ser anterior a la de inicio.');
  assert.equal(
    organizationMessages('en').absenceEndBeforeStart,
    'The end date cannot be before the start date.',
  );
  assert.deepEqual(calls, []);
});

test('PA 2411: overlapping absences of the same person are rejected in the action', async () => {
  const existing = [
    {
      id: '33333333-3333-4333-8333-333333333333',
      start_date: '2026-12-10',
      end_date: '2026-12-15',
    },
  ];
  const { db, calls } = fakeDb(existing);
  const run = await action(db);
  for (const [start, end] of [
    ['2026-12-14', '2026-12-20'],
    ['2026-12-15', '2026-12-15'],
    ['2026-12-01', '2026-12-10'],
    ['2026-12-11', '2026-12-12'],
  ]) {
    const result = await run(homeId, 'save_absence', {}, absence(start, end));
    assert.equal(result.error, es.absenceOverlap, `${start}..${end}`);
  }
  assert.deepEqual(calls, []);
  // Adjacent days do not overlap; editing the same absence is not a conflict with itself.
  assert.equal(
    (await run(homeId, 'save_absence', {}, absence('2026-12-16', '2026-12-20'))).error,
    undefined,
  );
  assert.equal(
    (await run(homeId, 'save_absence', {}, absence('2026-12-12', '2026-12-18', existing[0].id)))
      .error,
    undefined,
  );
  assert.deepEqual(calls, ['save_absence', 'save_absence']);
  // If the SQL check fires (e.g. concurrent save), the same clear message is shown.
  const raced = await action(fakeDb([], { message: 'absence_overlap' }).db);
  assert.equal(
    (await raced(homeId, 'save_absence', {}, absence('2026-12-16', '2026-12-20'))).error,
    es.absenceOverlap,
  );
});

test('PA 2464: difficulty 0 or 6 is not saved and the error names the 1 to 5 range', async () => {
  const { db, calls } = fakeDb([]);
  const run = await action(db);
  for (const difficulty of ['0', '6']) {
    const result = await run(
      homeId,
      'save_chore',
      {},
      form({
        name: 'Cocina',
        description: '',
        difficulty,
        recurrence: 'daily',
        interval_count: '1',
        anchor_date: '2026-11-25',
        assignment_mode: 'automatic',
        active: 'on',
      }),
    );
    assert.equal(result.error, 'La dificultad debe estar entre 1 y 5.');
  }
  assert.equal(organizationMessages('en').difficultyRange, 'Difficulty must be between 1 and 5.');
  assert.deepEqual(calls, []);
});

test('PA 2411: save_absence rejects overlaps in PostgreSQL (inclusive, editing excluded)', async () => {
  const { db, users, scalar, home } = await organizationDatabase();
  const [alice, bob] = users;
  const h = await home(2);
  const save = (who: string, start: string, end: string, id: string | null = null) =>
    scalar<string>('select public.save_absence($1,$2,$3,$4,$5,false) v', [h, id, who, start, end]);
  const first = await save(alice, '2026-12-10', '2026-12-15');
  await assert.rejects(save(alice, '2026-12-14', '2026-12-20'), /absence_overlap/);
  await assert.rejects(save(alice, '2026-12-15', '2026-12-15'), /absence_overlap/);
  await assert.rejects(save(alice, '2026-12-05', '2026-12-25'), /absence_overlap/);
  await assert.rejects(save(alice, '2026-12-20', '2026-12-16'), /absence_end_before_start/);
  const second = await save(alice, '2026-12-16', '2026-12-20');
  assert.equal(await save(alice, '2026-12-11', '2026-12-14', first), first);
  await assert.rejects(save(alice, '2026-12-11', '2026-12-16', first), /absence_overlap/);
  assert.ok(await save(bob, '2026-12-14', '2026-12-20'));
  await db.query('select public.save_absence($1,$2,$3,$4,$4,true)', [
    h,
    second,
    alice,
    '2026-12-16',
  ]);
  assert.ok(await save(alice, '2026-12-17', '2026-12-18'));
  await db.close();
});

const row = (id: string, overrides: Partial<ChoreInstance>): ChoreInstance => ({
  id,
  home_id: 'home',
  chore_id: 'chore',
  period_start: '2026-11-25',
  period_end: '2026-11-26',
  task_name: `Tarea ${id}`,
  difficulty: 3,
  assignee_id: 'me',
  assignee_name: 'Ana',
  assignment_blocked: false,
  generated_at: '',
  deadline_at: null,
  completed_at: null,
  cancelled_at: null,
  cancellation_reason: null,
  completed_by: null,
  completed_by_name: null,
  updated_at: '',
  ...overrides,
});

test('PA 2467/2687: completed rows are crossed out and overdue rows keep a visible mark', async () => {
  const html = renderToStaticMarkup(
    createElement(TaskList, {
      rows: [
        row('done', { completed_at: '2026-11-25T09:00:00Z', completed_by_name: 'Ana' }),
        row('late', { deadline_at: '2026-11-25T07:00:00Z' }),
      ],
      events: [],
      today: '2026-11-25',
      locale: 'es',
      completeAction: async () => ({}),
      stamp: (v: string) => v,
    }),
  );
  assert.match(html, /class="task-row completed" id="task-done"/);
  assert.match(html, /class="task-row overdue" id="task-late"/);
  assert.match(html, /badge overdue">Atrasada</);
  const css = await readFile('src/styles/system.css', 'utf8');
  const rule = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    assert.ok(start >= 0, `missing ${selector}`);
    return css.slice(start, css.indexOf('}', start));
  };
  assert.match(rule('.task-row.completed .task-identity h3'), /text-decoration: line-through/);
  const overdue = rule('.task-period .task-row.overdue');
  assert.match(overdue, /background: var\(--rose\)/);
  assert.match(overdue, /box-shadow: inset 4px 0 0 var\(--rose-ink\)/);
  // Declared after the neutral period row so the overdue mark wins at equal media.
  assert.ok(
    css.indexOf('.task-period .task-row.overdue {') > css.indexOf('.task-period .task-row {'),
  );
});
