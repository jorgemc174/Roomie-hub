import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { jsx } from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { Navigation } from '../src/components/navigation';
import { GET as legacyOrganization } from '../src/app/(workspace)/homes/[homeId]/organization/route';
import { OrganizationOptions } from '../src/features/organization/nav';
import { TaskNavigation } from '../src/features/organization/task-navigation';
import { organizationMessages } from '../src/features/organization/messages';
import { CommunityNav, CommunityOptions, communityTab } from '../src/features/community/nav';
import { communityMessages } from '../src/features/community/messages';
import { ExpensesNav, ExpensesOptions } from '../src/features/expenses/nav';
import { expenseMessages } from '../src/features/expenses/messages';
import { SectionDisclosure } from '../src/components/section-disclosure';
import { MessageActions } from '../src/features/chat/message-actions';
import { es, en } from '../src/lib/i18n/dictionaries';

test('nested workspace routes retain exactly one active section in both languages', () => {
  for (const t of [es, en]) {
    for (const [path, label] of [
      ['/homes/test', t.home],
      ['/homes/test/calendar', t.calendar],
      ['/homes/test/community/activities', t.community],
    ]) {
      const html = renderToStaticMarkup(
        createElement(
          PathnameContext.Provider,
          { value: path },
          createElement(Navigation, { homeId: 'test', t }),
        ),
      );
      const links = html.match(/<a\b[^>]*>/g) ?? [];
      assert.equal(links.length, 5);
      assert.ok(!html.includes('href="/homes/test/organization"'));
      const active = links.filter((link) => link.includes('aria-current='));
      assert.equal(active.length, 1);
      assert.ok(active[0].includes(`aria-label="${label}"`));
    }
  }
});

test('route prefixes alone do not activate an unrelated workspace section', () => {
  const html = renderToStaticMarkup(
    createElement(
      PathnameContext.Provider,
      { value: '/homes/test/organization-other' },
      createElement(Navigation, { homeId: 'test', t: es }),
    ),
  );
  assert.ok(!html.includes('aria-current='));
});

test('the old organization route redirects to its new section with filters and create state', async () => {
  const params = Promise.resolve({ homeId: 'test' });
  const cases = [
    ['view=all&from=2026-10-03', '/community?tab=tasks&view=all&from=2026-10-03'],
    ['tab=shopping&create=list', '/expenses?tab=shopping&create=list'],
    ['tab=absences&create=absence', '/community?tab=absences&create=absence'],
  ] as const;
  for (const [search, href] of cases) {
    const request = new Request(`http://localhost/homes/test/organization?${search}`);
    const response = await legacyOrganization(request, { params });
    assert.equal(response.status, 307);
    assert.equal(response.headers.get('Location'), `/homes/test${href}`);
  }
});

test('tasks keep absences in their options and make the active tab visible', () => {
  for (const locale of ['es', 'en'] as const) {
    for (const tab of ['tasks', 'absences']) {
      const html = renderToStaticMarkup(
        createElement(CommunityNav, { homeId: 'test', locale, tab }),
      );
      const options = renderToStaticMarkup(
        createElement(OrganizationOptions, { homeId: 'test', locale, tab }),
      );
      assert.ok(html.includes('href="/homes/test/community?tab=tasks"'));
      assert.ok(html.includes('aria-current="page"'));
      assert.ok(!html.includes('tab=absences'));
      assert.ok(options.includes('href="/homes/test/community?tab=absences"'));
      assert.ok(options.includes(organizationMessages(locale).absences));
      assert.equal(options.includes('aria-current="page"'), tab === 'absences');
    }
  }
});

test('task filters submit view and date together and summarize only non-default filters', () => {
  for (const locale of ['es', 'en'] as const) {
    const t = organizationMessages(locale);
    for (const view of ['mine', 'all', 'cancelled']) {
      const html = renderToStaticMarkup(
        jsx(TaskNavigation, {
          homeId: 'test',
          locale,
          view,
          from: '2026-10-03',
          today: '2026-11-01',
          children: null,
        }),
      );
      const summary = html.slice(0, html.indexOf('</summary>'));
      assert.ok(summary.includes(t.filters));
      assert.ok(summary.includes(t.from));
      if (view === 'all' || view === 'cancelled') assert.ok(summary.includes(t[view]));
      assert.ok(html.includes('action="/homes/test/community" method="get"'));
      assert.ok(html.includes('name="tab" value="tasks"'));
      assert.ok(html.includes('<select name="view">'));
      assert.ok(html.includes(`value="${view}" selected=""`));
      assert.ok(html.includes('name="from"'));
      assert.ok(html.includes('value="2026-10-03"'));
      assert.ok(html.includes(t.apply));
      assert.ok(!html.includes('open=""'));
      assert.ok(!html.includes(t.manage));
    }
    const defaults = renderToStaticMarkup(
      jsx(TaskNavigation, {
        homeId: 'test',
        locale,
        view: 'mine',
        from: '2026-11-01',
        today: '2026-11-01',
        children: null,
      }),
    );
    const summary = defaults.slice(0, defaults.indexOf('</summary>'));
    assert.ok(summary.includes(t.filters));
    assert.ok(!summary.includes(t.from));
    assert.ok(!summary.includes(t.mine));
  }
});

test('task configuration and its return keep the selected view and date in the URL', () => {
  for (const view of ['mine', 'all', 'cancelled']) {
    const options = renderToStaticMarkup(
      createElement(OrganizationOptions, {
        homeId: 'test',
        locale: 'es',
        tab: 'tasks',
        view,
        from: '2026-10-03',
      }),
    );
    assert.ok(
      options.includes(`?tab=tasks&amp;view=manage&amp;from=2026-10-03&amp;returnView=${view}`),
    );
    const back = renderToStaticMarkup(
      jsx(TaskNavigation, {
        homeId: 'test',
        locale: 'es',
        view: 'manage',
        from: '2026-10-03',
        returnView: view,
        children: null,
      }),
    );
    assert.ok(
      back.includes(`href="/homes/test/community?tab=tasks&amp;view=${view}&amp;from=2026-10-03"`),
    );
    assert.ok(!back.includes('<form'));
  }
});

test('community opens combined points and ranking from both old and default links', () => {
  for (const value of [undefined, '', 'unknown', 'ranking', ['points', 'ranking']]) {
    assert.equal(communityTab(value), 'points');
  }
  for (const tab of ['points', 'punishments', 'reasons']) {
    assert.equal(communityTab(tab), tab);
  }
});

test('community shows points and ranking together, tasks and punishments in both locales', () => {
  for (const locale of ['es', 'en'] as const) {
    const t = communityMessages(locale);
    for (const tab of ['points', 'tasks', 'punishments', 'reasons']) {
      const html = renderToStaticMarkup(
        createElement(CommunityNav, { homeId: 'test', locale, tab }),
      );
      const labels = Array.from(html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g), (match) =>
        match[1].replace(/<[^>]*>/g, ''),
      );
      assert.deepEqual(labels, [
        t.pointsAndRanking,
        organizationMessages(locale).tasks,
        t.punishments,
      ]);
      assert.ok(!html.includes('/community/activities'));
      assert.ok(!html.includes('tab=reasons'));
      const options = renderToStaticMarkup(
        createElement(CommunityOptions, { homeId: 'test', locale, tab }),
      );
      assert.ok(options.includes('class="ui-options-menu"'));
      assert.ok(!options.includes('open=""'));
      assert.ok(options.includes('href="/homes/test/community?tab=reasons"'));
      assert.ok(options.includes(t.configureReasons));
      const active = ((html + options).match(/<a\b[^>]*>/g) ?? []).filter((link) =>
        link.includes('aria-current="page"'),
      );
      assert.equal(active.length, 1);
      assert.ok(active[0].includes(`?tab=${tab}`));
    }
  }
});

test('expenses includes purchase lists and separates routine destinations from its change history and keeps deep links active', () => {
  for (const locale of ['es', 'en'] as const) {
    const t = expenseMessages(locale);
    for (const tab of ['expenses', 'balances', 'recurring', 'shopping', 'history']) {
      const html = renderToStaticMarkup(
        createElement(ExpensesNav, { homeId: 'test', locale, tab }),
      );
      const labels = Array.from(html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g), (match) =>
        match[1].replace(/<[^>]*>/g, ''),
      );
      assert.deepEqual(labels, [
        t.movements,
        t.balances,
        t.recurring,
        organizationMessages(locale).shopping,
      ]);
      assert.ok(!html.includes('tab=history'));
      const options = renderToStaticMarkup(
        createElement(ExpensesOptions, { homeId: 'test', locale, tab }),
      );
      assert.ok(options.includes('class="ui-options-menu"'));
      assert.ok(!options.includes('open=""'));
      assert.ok(options.includes(t.changeHistory));
      const active = ((html + options).match(/<a\b[^>]*>/g) ?? []).filter((link) =>
        link.includes('aria-current="page"'),
      );
      assert.equal(active.length, 1);
      assert.ok(active[0].includes(`href="/homes/test/expenses?tab=${tab}"`));
    }
  }
});

test('settings and filter disclosures support native keyboard controls and explicit active state', () => {
  const closed = renderToStaticMarkup(
    jsx(SectionDisclosure, { title: 'Settings', children: 'Controls' }),
  );
  const open = renderToStaticMarkup(
    jsx(SectionDisclosure, { title: 'Filters', defaultOpen: true, children: 'Controls' }),
  );
  assert.ok(closed.includes('<summary>'));
  assert.ok(!closed.includes('open=""'));
  assert.ok(open.includes('open=""'));
  assert.ok(!open.includes('role="menu"'));
});

test('message options preserve edit ownership, reactions and pending safeguards', () => {
  const props = {
    locale: 'es' as const,
    pending: false,
    own: false,
    reactions: [],
    onReply() {},
    onEdit() {},
    onRemove() {},
    onReaction() {},
  };
  const other = renderToStaticMarkup(createElement(MessageActions, props));
  assert.ok(!other.includes('>Editar</button>'));
  assert.ok(other.includes('>Eliminar</button>'));
  assert.equal((other.match(/<summary>/g) ?? []).length, 1);
  assert.equal((other.match(/aria-pressed=/g) ?? []).length, 6);
  const own = renderToStaticMarkup(
    createElement(MessageActions, { ...props, own: true, pending: true }),
  );
  assert.ok(own.includes('>Editar</button>'));
  assert.equal((own.match(/<button\b/g) ?? []).length, (own.match(/disabled=""/g) ?? []).length);
});
