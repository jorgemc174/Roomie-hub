import { CategoryFilter } from '../src/features/expenses/category-filter';
import { CategoryLabel, CategorySummary } from '../src/features/expenses/category-summary';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { createElement, type ReactNode } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import Link from 'next/link';
import { CalendarDays, ListChecks, Wallet } from 'lucide-react';
import { PageHeader } from '../src/components/ui/page-header';
import { CreatePanel } from '../src/components/ui/create-panel';
import { EmptyState } from '../src/components/ui/empty-state';
import { OptionsMenu } from '../src/components/ui/options-menu';
import { SectionDisclosure } from '../src/components/section-disclosure';
import * as expensesNav from '../src/features/expenses/nav';
import { PendingOccurrence } from '../src/features/expenses/pending-occurrence';
import {
  readExpenseActivity,
  readCategoryTotals,
  type ExpenseActivity,
} from '../src/features/expenses/activity';
import * as money from '../src/features/expenses/money';
import * as messages from '../src/features/expenses/messages';
import { calendarMessages } from '../src/features/calendar/messages';
import { organizationMessages } from '../src/features/organization/messages';
import { homeDate } from '../src/lib/timezones';
import { es, en, type Locale } from '../src/lib/i18n/dictionaries';

// Render the actual async Server Components with explicit read/action dependencies.
// No Supabase credentials, business writes, or Next server are needed for these layout regressions.
async function component<T>(file: string, dependencies: Record<string, unknown>): Promise<T> {
  const { outputText } = ts.transpileModule(await readFile(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: false,
    },
  });
  const exports = {};
  vm.runInNewContext(
    outputText,
    {
      exports,
      crypto,
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

function reads(tables: Record<string, unknown[]>, failed?: string) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  return {
    calls,
    from(table: string) {
      let category: unknown;
      const query = {
        select(...args: unknown[]) {
          return record('select', args);
        },
        eq(...args: unknown[]) {
          if (args[0] === 'category') category = args[1];
          return record('eq', args);
        },
        is(...args: unknown[]) {
          return record('is', args);
        },
        in(...args: unknown[]) {
          return record('in', args);
        },
        lte(...args: unknown[]) {
          return record('lte', args);
        },
        gte(...args: unknown[]) {
          return record('gte', args);
        },
        order(...args: unknown[]) {
          return record('order', args);
        },
        range(...args: unknown[]) {
          return record('range', args);
        },
        limit(...args: unknown[]) {
          return record('limit', args);
        },
        then(
          resolve: (value: {
            data: unknown[];
            count: number;
            error: null | { code: string };
          }) => unknown,
        ) {
          return Promise.resolve(
            resolve({
              data: (tables[table] ?? []).filter(
                (r) => category === undefined || (r as { category?: string }).category === category,
              ),
              count: tables[table]?.length ?? 0,
              error: failed === table ? { code: 'READ_FAILED' } : null,
            }),
          );
        },
      };
      function record(method: string, args: unknown[]) {
        calls.push({ table, method, args });
        return query;
      }
      return query;
    },
  };
}

async function organizationSummary(locale: Locale) {
  const { OrganizationSummary } = await component<{
    OrganizationSummary: (props: { homeId: string }) => Promise<ReactNode>;
  }>('src/features/organization/summary.tsx', {
    'lucide-react': { ListChecks },
    'next/link': { default: Link },
    '@/lib/data': {
      requireUser: async () => ({
        user: { id: 'me' },
        db: reads({
          chore_instances: [{ id: 'task', deadline_at: '2020-01-01T12:00:00Z' }],
          shopping_items: [{ id: 'item' }],
        }),
      }),
      getHome: async () => ({ timezone: 'Europe/Madrid' }),
    },
    '@/lib/timezones': { homeDate },
    '@/lib/i18n/server': { i18n: async () => ({ locale }) },
    './messages': { organizationMessages },
    './read-rows': { readRows: async (query: PromiseLike<unknown>) => await query },
  });
  return await OrganizationSummary({ homeId: 'test' });
}

test('Home prioritizes operational summaries, keeps one tasks/shopping destination and a secondary invitation in es/en', async () => {
  for (const locale of ['es', 'en'] as const) {
    const t = locale === 'es' ? es : en;
    const org = organizationMessages(locale);
    const summary = await organizationSummary(locale);
    const { ExpenseSummary } = await component<{
      ExpenseSummary: (props: { homeId: string }) => Promise<ReactNode>;
    }>('src/features/expenses/summary.tsx', {
      'lucide-react': { Wallet },
      'next/link': { default: Link },
      '@/lib/data': {
        getHome: async () => ({ currency: 'EUR' }),
        requireUser: async () => ({
          user: { id: 'me' },
          db: { rpc: async () => ({ data: [], error: null }) },
        }),
      },
      '@/lib/i18n/server': { i18n: async () => ({ locale }) },
      './messages': messages,
      './money': money,
      './activity': { readExpenseActivity, readCategoryTotals },
    });
    const expenseSummary = await ExpenseSummary({ homeId: 'test' });
    const { default: HomePage } = await component<{
      default: (props: { params: Promise<{ homeId: string }> }) => Promise<ReactNode>;
    }>('src/app/(workspace)/homes/[homeId]/page.tsx', {
      '@/components/ui/page-header': { PageHeader },
      '@/features/organization/summary': { OrganizationSummary: () => summary },
      '@/features/expenses/summary': {
        ExpenseSummary: () => expenseSummary,
      },
      '@/features/community/summary': {
        CommunitySummary: () => createElement('p', null, 'Own points'),
      },
      '@/components/ui/upcoming-event': {
        UpcomingEvent: () => createElement('p', null, t.nextEvent),
      },
      'next/link': { default: Link },
      'lucide-react': { UserPlus: () => null, ArrowUpRight: () => null },
      '@/lib/data': {
        getMembers: async () => [],
        requireUser: async () => ({ user: { id: 'me' } }),
        signedImage: async () => null,
      },
      '@/lib/i18n/server': { i18n: async () => ({ locale, t }) },
    });
    const html = renderToStaticMarkup(
      await HomePage({ params: Promise.resolve({ homeId: 'test' }) }),
    );
    const links = Array.from(html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>/g), (m) => m[1]);
    assert.equal(links.filter((href) => href === '/homes/test/organization').length, 1);
    assert.equal(
      links.filter((href) => href === '/homes/test/organization?tab=shopping').length,
      1,
    );
    assert.ok(!links.some((href) => href.includes('create=task')));
    assert.ok(html.includes(org.pendingTasks));
    assert.ok(html.includes(org.overdueTasks));
    assert.ok(html.indexOf(org.pendingTasks) < html.indexOf('create=expense'));
    const invite = html.match(/<a[^>]+href="\/homes\/test\/settings#invitation"[^>]*>/)?.[0];
    assert.ok(invite);
    assert.ok(invite.includes('class="text-link home-invitation"'));
    assert.ok(!invite.includes('button'));
    assert.ok(!html.includes('ranking'));
    assert.ok(!html.includes('ui-quick-actions'));
    assert.equal(links.filter((href) => href.includes('create=expense')).length, 1);
    const balancePanel = html.slice(html.indexOf('<section class="panel balance-panel"'));
    assert.ok(balancePanel.slice(0, balancePanel.indexOf('</section>')).includes('create=expense'));
    assert.ok(!html.includes(t.workspaceBody));
  }
});

test('next event compares reservations/activities, uses the home timezone, and handles empty/failed reads', async () => {
  for (const locale of ['es', 'en'] as const) {
    const t = locale === 'es' ? es : en;
    for (const mode of ['populated', 'empty', 'error'] as const) {
      const db = reads(
        mode === 'empty'
          ? {}
          : {
              reservations: [
                {
                  id: 'r',
                  title: 'Laundry',
                  resource_name: 'Washer',
                  starts_at: '2040-01-01T12:30:00Z',
                },
              ],
              activities: [{ id: 'a', title: 'Dinner', starts_at: '2040-01-01T13:30:00Z' }],
            },
        mode === 'error' ? 'activities' : undefined,
      );
      const { UpcomingEvent } = await component<{
        UpcomingEvent: (props: { homeId: string }) => Promise<ReactNode>;
      }>('src/components/ui/upcoming-event.tsx', {
        'lucide-react': { CalendarDays },
        'next/link': { default: Link },
        '@/lib/data': {
          getHome: async () => ({ timezone: 'Pacific/Auckland' }),
          requireUser: async () => ({ db }),
        },
        '@/lib/i18n/server': { i18n: async () => ({ locale, t }) },
        '@/lib/timezones': { homeDate },
        '@/features/calendar/messages': { calendarMessages },
      });
      const html = renderToStaticMarkup(await UpcomingEvent({ homeId: 'test' }));
      assert.equal((html.match(/<a\b/g) ?? []).length, 1);
      if (mode === 'populated') {
        assert.ok(html.includes('Washer · Laundry'));
        assert.ok(!html.includes('Dinner'));
        assert.ok(html.includes('?month=2040-01&amp;day=2040-01-02'));
      } else if (mode === 'empty') {
        assert.ok(html.includes(t.noUpcomingEvents));
      } else {
        assert.ok(html.includes('role="alert"'));
        assert.ok(!html.includes('Laundry'));
        assert.ok(!html.includes(t.noUpcomingEvents));
      }
      for (const table of ['reservations', 'activities']) {
        assert.ok(
          db.calls.some(
            (c) =>
              c.table === table &&
              c.method === 'eq' &&
              c.args[0] === 'home_id' &&
              c.args[1] === 'test',
          ),
        );
        assert.ok(
          db.calls.some(
            (c) => c.table === table && c.method === 'is' && c.args[0] === 'cancelled_at',
          ),
        );
        assert.ok(
          db.calls.some(
            (c) => c.table === table && c.method === 'gte' && c.args[0] === 'starts_at',
          ),
        );
        assert.ok(
          db.calls.some((c) => c.table === table && c.method === 'limit' && c.args[0] === 1),
        );
      }
    }
  }
});

async function expensesPage(
  locale: Locale,
  search: Record<string, string>,
  balance = '1250',
  empty = false,
  activity: ExpenseActivity[] = [],
) {
  const db = {
    ...reads({
      expenses: empty
        ? []
        : [
            {
              id: 'rent',
              title: 'Monthly rent',
              amount: 5000,
              currency: 'EUR',
              expense_date: '2026-11-01',
              payer: 'me',
              payer_name: 'Pat',
              category: 'rent',
              version: 1,
              deleted_at: null,
            },
            {
              id: 'expense',
              title: 'Groceries',
              amount: 2500,
              currency: 'EUR',
              expense_date: '2026-11-01',
              payer: 'me',
              payer_name: 'Pat',
              category: 'groceries',
              version: 2,
              deleted_at: null,
            },
          ],
      expense_splits: [
        { expense_id: 'expense', user_id: 'me', user_name: 'Pat', amount: 1250, weight: 1 },
      ],
      expense_attachments: [{ id: 'receipt', expense_id: 'expense' }],
      settlements: [
        {
          id: 'payment',
          payment_date: '2026-11-01',
          created_at: '2026-11-01T12:00:00Z',
          from_name: 'Sam',
          to_name: 'Pat',
          amount: 1250,
          currency: 'EUR',
        },
      ],
      recurring_expense_instances: [
        {
          id: 'due',
          status: 'pending',
          period_date: '2026-11-01',
          recurrence_kind: 'variable',
          template: {
            title: 'Utilities',
            amount: '',
            payer: 'me',
            participants: [{ user_id: 'me', weight: '1' }],
          },
        },
      ],
    }),
    rpc: async (name: string, args?: { selected_category?: string }) => ({
      error: null,
      data:
        name === 'expense_category_totals'
          ? (empty
              ? []
              : [
                  { category: 'rent', amount: '5000' },
                  { category: 'groceries', amount: '2500' },
                ]
            ).filter((r) => !args?.selected_category || r.category === args.selected_category)
          : name === 'expense_activity'
            ? activity
            : name === 'expense_balances'
              ? [
                  { user_id: 'me', name: 'Pat', active: true, balance },
                  {
                    user_id: 'other',
                    name: 'Sam',
                    active: true,
                    balance: (-BigInt(balance)).toString(),
                  },
                ]
              : { more: true },
    }),
  };
  const action = () => Promise.resolve({});
  const { ExpensesPage } = await component<{
    ExpensesPage: (props: { homeId: string; search: Record<string, string> }) => Promise<ReactNode>;
  }>('src/features/expenses/page.tsx', {
    '@/components/ui/create-panel': { CreatePanel },
    '@/components/ui/empty-state': { EmptyState },
    './nav': expensesNav,
    '@/components/ui/options-menu': { OptionsMenu },
    '@/components/ui/page-header': { PageHeader },
    './pending-occurrence': { PendingOccurrence },
    '@/components/section-disclosure': { SectionDisclosure },
    'next/link': { default: Link },
    '@/lib/data': {
      getHome: async () => ({ currency: 'EUR', timezone: 'Europe/Madrid' }),
      getMembers: async () => [{ user_id: 'me', profiles: { name: 'Pat' } }],
      requireUser: async () => ({ db, user: { id: 'me' } }),
    },
    '@/lib/i18n/server': { i18n: async () => ({ locale, t: locale === 'es' ? es : en }) },
    '@/components/action-form': {
      ActionForm: ({ children, label }: { children: ReactNode; label: string }) =>
        createElement('form', null, children, createElement('button', null, label)),
    },
    '@/features/organization/read-rows': {
      readRows: async (query: PromiseLike<unknown>) => await query,
    },
    '@/lib/timezones': { homeDate },
    './messages': messages,
    './category-filter': { CategoryFilter },
    './category-summary': { CategoryLabel, CategorySummary },
    './money': money,
    './activity': { readExpenseActivity, readCategoryTotals },
    './expense-form': {
      ExpenseForm: ({
        id,
        operation = 'save',
        initial,
      }: {
        id: string;
        operation?: string;
        initial?: { amount: string };
      }) =>
        createElement(
          'form',
          { 'data-operation': operation, 'data-request-id': id },
          createElement('input', { name: 'amount', defaultValue: initial?.amount }),
        ),
    },
    './actions': { financeAction: action },
  });
  return renderToStaticMarkup(await ExpensesPage({ homeId: 'test', search }));
}

test('expenses keep compact balances, row details/actions, header processing, payment ordering and deep links in es/en', async () => {
  for (const locale of ['es', 'en'] as const) {
    const t = messages.expenseMessages(locale);
    for (const [balance, label] of [
      ['1250', t.owed],
      ['-1250', t.owe],
      ['0', t.zero],
    ]) {
      const html = await expensesPage(locale, { tab: 'expenses', create: 'expense' }, balance);
      assert.ok(!html.includes('panel balance-panel'));
      assert.ok(html.includes('class="expense-balance row wrap"'));
      assert.ok(html.includes(label));
      assert.ok(html.indexOf(t.generate) < html.indexOf('<nav'));
      assert.ok(html.includes('id="new-expense" open=""'));
      const row = html.slice(html.indexOf('id="expense-expense"'));
      assert.ok(row.includes('Groceries'));
      assert.ok(row.includes('data-request-id="expense"'));
      assert.ok(row.includes('name="version" value="2"'));
      assert.match(row.match(/<input[^>]+name="confirm"[^>]*>/)?.[0] ?? '', /required=""/);
      const detail = row.slice(row.indexOf(`<summary>${t.details}</summary>`));
      assert.ok(detail.includes(money.formatMoney(1250, 'EUR', locale)));
      assert.ok(detail.includes('href="/homes/test/expenses/receipt/receipt"'));
      assert.ok(row.indexOf(t.edit) < row.indexOf(t.details));
    }
    const balances = await expensesPage(locale, { tab: 'balances' });
    assert.ok(balances.indexOf('id="record-payment"') < balances.indexOf(`<h2>${t.balances}</h2>`));
    assert.ok(balances.includes('id="payment-history"><summary>'));
    const history = await expensesPage(locale, { tab: 'balances', page: '1', payments: 'history' });
    assert.ok(history.includes('id="payment-history" open=""'));
    assert.ok(history.includes('?tab=balances&amp;page=0&amp;payments=history#payment-history'));
    const recurring = await expensesPage(locale, { tab: 'recurring' });
    assert.ok(recurring.includes('id="occurrence-due"><summary>'));
    assert.ok(recurring.includes(t.variable));
    assert.ok(recurring.includes('data-operation="confirm" data-request-id="due"'));
    const audit = await expensesPage(locale, { tab: 'history' });
    assert.ok(audit.includes(t.audit));
    assert.ok(audit.includes(t.noHistory));
    assert.match(
      audit.match(/<a[^>]+href="[^"]*tab=history"[^>]*>/)?.[0] ?? '',
      /aria-current="page"/,
    );
  }
});

test('empty expenses use the existing CreatePanel as the sole creation entry in es/en', async () => {
  for (const locale of ['es', 'en'] as const) {
    const html = await expensesPage(locale, {}, '0', true);
    assert.equal((html.match(/class="panel ui-create-panel"/g) ?? []).length, 1);
    const empty = html.slice(html.indexOf('<section class="ui-empty-state"'));
    assert.ok(empty.includes(messages.expenseMessages(locale).empty));
    assert.ok(!empty.slice(0, empty.indexOf('</section>')).includes('<a'));
  }
});

test('expense category filter and summary use URL state and exact amounts in both languages', async () => {
  for (const locale of ['es', 'en'] as const) {
    const t = messages.expenseMessages(locale);
    const html = await expensesPage(locale, { category: 'groceries', page: '1' });
    assert.ok(html.includes('name="category"'));
    assert.match(html, /<noscript><button[^>]*type="submit"/);
    assert.ok(html.includes('expense-category-track'));
    assert.ok(html.includes('width:100%'));
    assert.ok(html.includes(money.categoryColors.groceries));
    assert.match(html, /<option value="groceries" selected="">/);
    assert.ok(html.includes(t.clearFilter));
    assert.ok(html.includes(t.listedTotal));
    assert.ok(html.includes(t.categorySummary));
    assert.ok(!html.includes('Monthly rent'));
    const all = await expensesPage(locale, {});
    assert.ok(all.includes('Monthly rent'));
    assert.ok(all.includes(money.formatMoney(7500n, 'EUR', locale)));
    assert.ok(html.includes(money.formatMoney(2500n, 'EUR', locale)));
    assert.ok(html.includes(locale === 'es' ? '100,00' : '100.00'));
    assert.ok(html.includes('page=0&amp;category=groceries'));
    const invalid = await expensesPage(locale, { category: 'invalid' });
    assert.match(invalid, /<option value="" selected="">/);
    assert.ok(!invalid.includes(t.clearFilter));
  }
});

test('suggested payment opens the existing form with current sender, recipient and exact amount', async () => {
  for (const locale of ['es', 'en'] as const) {
    const html = await expensesPage(locale, { tab: 'balances' });
    assert.ok(html.includes(messages.expenseMessages(locale).registerSuggested));
    assert.ok(html.includes('sender=other&amp;recipient=me&amp;amount=1250#record-payment'));
    const opened = await expensesPage(locale, {
      tab: 'balances',
      create: 'payment',
      sender: 'other',
      recipient: 'me',
      amount: '1250',
    });
    assert.ok(opened.includes('id="record-payment" open=""'));
    assert.match(opened, /name="sender">[\s\S]*?<option value="other" selected="">/);
    assert.match(opened, /name="recipient">[\s\S]*?<option value="me" selected="">/);
    assert.match(opened, /name="amount"[^>]*value="12.50"/);
    const stale = await expensesPage(
      locale,
      { tab: 'balances', create: 'payment', sender: 'other', recipient: 'me', amount: '1250' },
      '0',
    );
    assert.ok(!stale.includes('value="12.50"'));
    assert.ok(!stale.includes(messages.expenseMessages(locale).registerSuggested));
  }
});

test('activity renders revision time and payment time in the home timezone in both languages', async () => {
  const activity: ExpenseActivity[] = [
    {
      id: 'r2',
      kind: 'revision',
      recorded_at: '2026-11-01T12:00:00Z',
      payload: {
        id: 'r2',
        home_id: 'test',
        expense_id: 'expense',
        actor: 'me',
        actor_name: 'Pat',
        revision: 2,
        recorded_at: '2026-11-01T12:00:00Z',
        snapshot: {
          expense: {
            title: 'Edited dinner',
            amount: 1000,
            currency: 'EUR',
            payer_name: 'Pat',
            deleted_at: null,
          },
          splits: [],
        },
      },
    },
    {
      id: 'p1',
      kind: 'payment',
      recorded_at: '2026-11-01T11:00:00Z',
      payload: {
        id: 'p1',
        home_id: 'test',
        from_user: 'other',
        to_user: 'me',
        from_name: 'Sam',
        to_name: 'Pat',
        amount: 500,
        currency: 'EUR',
        payment_date: '2026-10-31',
        created_by: 'me',
        created_by_name: 'Pat',
        created_at: '2026-11-01T11:00:00Z',
      },
    },
  ];
  for (const locale of ['es', 'en'] as const) {
    const html = await expensesPage(locale, { tab: 'history' }, '0', false, activity);
    const expected = new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Europe/Madrid',
    }).format(new Date(activity[0].recorded_at));
    assert.ok(html.includes(expected));
    assert.ok(html.includes('dateTime="2026-11-01T12:00:00Z"'));
    assert.ok(html.includes(messages.expenseMessages(locale).paymentRecorded));
    assert.ok(html.indexOf('Edited dinner') < html.indexOf('Sam'));
    assert.ok(!html.includes(messages.expenseMessages(locale).noHistory));
  }
});
