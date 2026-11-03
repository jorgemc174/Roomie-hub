import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { createElement, type ReactNode } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import Link from 'next/link';
import { TaskList } from '../src/features/organization/task-list';
import * as logic from '../src/features/organization/logic';
import { splitTaskPeriods } from '../src/features/organization/task-periods';
import { organizationMessages } from '../src/features/organization/messages';
import type { ChoreInstance } from '../src/features/organization/models';
import { OrganizationNav, OrganizationOptions } from '../src/features/organization/nav';
import { TaskNavigation } from '../src/features/organization/task-navigation';
import { OptionsMenu } from '../src/components/ui/options-menu';
import { CreatePanel } from '../src/components/ui/create-panel';
import { EmptyState } from '../src/components/ui/empty-state';
import { PageHeader } from '../src/components/ui/page-header';
import { SectionDisclosure } from '../src/components/section-disclosure';
import { es, en, type Locale } from '../src/lib/i18n/dictionaries';

const today = '2026-11-02';
function row(
  id: string,
  start: string,
  end: string,
  overrides: Partial<ChoreInstance> = {},
): ChoreInstance {
  return {
    id,
    home_id: 'home',
    chore_id: 'chore',
    period_start: start,
    period_end: end,
    task_name: `Task ${id}`,
    difficulty: 3,
    assignee_id: 'me',
    assignee_name: 'Roomie de prueba',
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
  };
}
const renderList = (rows: ChoreInstance[], locale: Locale) =>
  renderToStaticMarkup(
    createElement(TaskList, {
      rows,
      events: [],
      today,
      locale,
      completeAction: async () => ({}),
      stamp: (v) => v,
    }),
  );

// Execute the real server page with explicit read/action dependencies; no credentials or writes.
async function component<T>(
  file: string,
  dependencies: Record<string, unknown>,
  globals: Record<string, unknown> = {},
): Promise<T> {
  const { outputText } = ts.transpileModule(await readFile(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const exports = {};
  vm.runInNewContext(
    outputText,
    {
      exports,
      URLSearchParams,
      ...globals,
      require: (name: string) => {
        if (name === 'react/jsx-runtime') return jsxRuntime;
        if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
        return dependencies[name];
      },
    },
    { filename: file },
  );
  return exports as T;
}

test('period presentation puts today/current before future, folds only unfinished previous periods, and preserves every occurrence', () => {
  const rows = [
    row('old', '2026-10-19', '2026-10-26'),
    row('future', '2026-11-09', '2026-11-16'),
    row('week', today, '2026-11-09'),
    row('today', today, '2026-11-03'),
    row('boundary', '2026-10-26', today),
    row('done', '2026-10-19', '2026-10-26', { completed_at: '2026-10-23T12:00:00Z' }),
    row('cancelled', '2026-10-19', '2026-10-26', { cancelled_at: '2026-10-23T12:00:00Z' }),
  ];
  const original = structuredClone(rows);
  const result = splitTaskPeriods(rows, today);
  assert.deepEqual(
    result.visible.flatMap((g) => g.items.map((i) => i.id)),
    ['today', 'week', 'future', 'done', 'cancelled'],
  );
  assert.deepEqual(
    result.backlog.flatMap((g) => g.items.map((i) => i.id)),
    ['boundary', 'old'],
  );
  assert.equal(result.backlogCount, 2);
  assert.equal(
    new Set([...result.visible, ...result.backlog].flatMap((g) => g.items.map((i) => i.id))).size,
    rows.length,
  );
  assert.deepEqual(rows, original);
});

test('seven overdue weeks plus current week render 35 folded tasks and five compact initial rows in es/en', () => {
  const rows = Array.from({ length: 8 }, (_, week) =>
    Array.from({ length: 5 }, (_, task) =>
      row(
        `${week}-${task}`,
        logic.addDays(today, (week - 7) * 7),
        logic.addDays(today, (week - 6) * 7),
      ),
    ),
  ).flat();
  for (const locale of ['es', 'en'] as const) {
    const t = organizationMessages(locale);
    const html = renderList(rows, locale);
    assert.equal((html.match(/<article\b/g) ?? []).length, 40);
    const folded = html.slice(html.indexOf('<details class="section-disclosure"'));
    assert.match(folded, /^<details class="section-disclosure" id="overdue-tasks">/);
    assert.ok(folded.includes(`${t.backlog} (35)`));
    assert.ok(folded.includes(t.backlogHelp));
    assert.equal((folded.match(/<article\b/g) ?? []).length, 35);
    assert.equal((html.slice(0, html.indexOf(folded)).match(/<article\b/g) ?? []).length, 5);
    assert.equal((html.match(/class="task-period"/g) ?? []).length, 8);
    assert.ok(!html.includes('badge pending'));
    assert.ok(!html.includes(t.complete));
    assert.equal((html.match(new RegExp(`>${t.done}</button>`, 'g')) ?? []).length, 40);
    assert.ok(!html.includes(`<summary>${t.detailsHistory}</summary>`));
    assert.ok(html.includes(`aria-label="${t.detailsHistory}: Task 7-0"`));
    assert.ok(html.includes('name="id" value="7-0"'));
    const firstRow = html.slice(html.indexOf('<article'), html.indexOf('</article>'));
    assert.ok(firstRow.includes('Roomie de prueba'));
    assert.ok(firstRow.includes('dateTime="2026-11-08"'));
    assert.ok(!renderList([], locale).includes('overdue-tasks'));
    assert.ok(!renderList([rows[35]], locale).includes('overdue-tasks'));
  }
});

test('compact rows preserve warnings, completed/cancelled state and individual audit details', () => {
  const rows = [
    row('blocked', today, '2026-11-09', {
      assignment_blocked: true,
      deadline_at: '2000-01-01T00:00:00Z',
    }),
    row('done', today, '2026-11-09', {
      completed_at: '2026-11-02T12:00:00Z',
      completed_by_name: 'Sam',
    }),
    row('cancelled', today, '2026-11-09', { cancelled_at: '2026-11-02T12:00:00Z' }),
  ];
  for (const locale of ['es', 'en'] as const) {
    const t = organizationMessages(locale);
    const html = renderList(rows, locale);
    const beforeMenu = html.slice(0, html.indexOf('<details'));
    assert.ok(beforeMenu.includes(t.blocked));
    assert.ok(beforeMenu.includes(t.overdue));
    assert.ok(html.includes('badge completed'));
    assert.ok(html.includes('badge cancelled'));
    assert.ok(html.includes(`${t.completedBy}: Sam`));
    assert.equal((html.match(/type="submit"/g) ?? []).length, 1);
  }
});

test('task deep links open folded ancestors on initial load and hash changes, and clean up the listener', async () => {
  let effect: (() => void) | undefined;
  let listener: (() => void) | undefined;
  let cleanup: (() => void) | undefined;
  let scrolled = 0;
  class Details {
    open = false;
    parentElement = null;
  }
  const backlog = new Details();
  const target = {
    classList: { contains: (v: string) => v === 'task-row' },
    parentElement: backlog,
    scrollIntoView: () => {
      scrolled++;
    },
  };
  const location = { hash: '#task-old' };
  const { TaskAnchor } = await component<{ TaskAnchor: (props: { instanceIds: string }) => null }>(
    'src/features/organization/task-anchor.tsx',
    {
      react: {
        useEffect: (run: () => () => void) => {
          effect = () => {
            cleanup = run();
          };
        },
      },
    },
    {
      window: {
        location,
        addEventListener: (_: string, fn: () => void) => {
          listener = fn;
        },
        removeEventListener: (_: string, fn: () => void) => {
          assert.equal(listener, fn);
          listener = undefined;
        },
      },
      document: { getElementById: (id: string) => (id === 'task-old' ? target : null) },
      HTMLDetailsElement: Details,
    },
  );
  TaskAnchor({ instanceIds: 'old' });
  effect!();
  assert.equal(backlog.open, true);
  assert.equal(scrolled, 1);
  backlog.open = false;
  location.hash = '#other';
  listener!();
  assert.equal(backlog.open, false);
  location.hash = '#task-old';
  listener!();
  assert.equal(backlog.open, true);
  assert.equal(scrolled, 2);
  cleanup!();
  assert.equal(listener, undefined);
});

test('empty tasks, shopping and absences keep exactly one creation entry and a stable Organization h1', async () => {
  for (const locale of ['es', 'en'] as const) {
    const t = organizationMessages(locale);
    const { OrganizationPage } = await component<{
      OrganizationPage: (props: {
        homeId: string;
        search: Record<string, string>;
      }) => Promise<ReactNode>;
    }>('src/features/organization/page.tsx', {
      '@/components/ui/create-panel': { CreatePanel },
      '@/components/ui/empty-state': { EmptyState },
      './nav': { OrganizationNav, OrganizationOptions },
      '@/components/ui/options-menu': { OptionsMenu },
      '@/components/ui/page-header': { PageHeader },
      './task-list': { TaskList },
      './shopping-controls': { ShoppingAnchor: () => null, DeleteShoppingList: () => null },
      './task-navigation': { TaskNavigation },
      '@/components/section-disclosure': { SectionDisclosure },
      '@/features/expenses/messages': { expenseMessages: () => ({}) },
      'next/link': { default: Link },
      '@/lib/data': {
        getHome: async () => ({ timezone: 'UTC' }),
        getMembers: async () => [],
        requireUser: async () => ({
          db: { rpc: async () => ({ error: null }) },
          user: { id: 'me' },
        }),
      },
      '@/lib/i18n/server': { i18n: async () => ({ locale, t: locale === 'es' ? es : en }) },
      '@/components/action-form': {
        ActionForm: ({ children }: { children: ReactNode }) =>
          createElement('form', null, children),
      },
      './messages': { organizationMessages },
      './actions': { organizationAction: async () => ({}) },
      './logic': logic,
      './chore-form': { ChoreForm: () => null },
      './queries': {
        readOrganizationRows: async () =>
          Object.fromEntries(
            ['chores', 'rotations', 'instances', 'absences', 'lists', 'items', 'events'].map(
              (key) => [key, { data: [], error: null }],
            ),
          ),
      },
      '@/lib/timezones': { homeDate: () => today },
      './generation': { ensureOrganizationPeriod: async () => ({ error: null }) },
    });
    for (const [tab, label] of [
      ['tasks', t.newTask],
      ['shopping', t.newList],
      ['absences', t.absent],
    ]) {
      const html = renderToStaticMarkup(
        await OrganizationPage({ homeId: 'test', search: { tab } }),
      );
      assert.ok(html.includes(`<h1>${t.title}</h1>`));
      assert.equal((html.match(/class="panel ui-create-panel"/g) ?? []).length, 1);
      const empty = html.slice(
        html.indexOf('<section class="ui-empty-state"'),
        html.indexOf('</section>', html.indexOf('<section class="ui-empty-state"')),
      );
      assert.ok(!empty.includes('<a'));
      assert.ok(!empty.includes(label));
    }
  }
});
