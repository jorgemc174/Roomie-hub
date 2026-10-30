import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { jsx } from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { Navigation } from '../src/components/navigation';
import { OrganizationNav, OrganizationLoadError } from '../src/features/organization/nav';
import { CommunityNav } from '../src/features/community/nav';
import { ExpensesNav } from '../src/features/expenses/nav';
import { SectionDisclosure } from '../src/components/section-disclosure';
import { MessageActions } from '../src/features/chat/message-actions';
import { es, en } from '../src/lib/i18n/dictionaries';

test('nested workspace routes retain exactly one active section in both languages', () => {
  for (const t of [es, en]) {
    for (const [path, label] of [
      ['/homes/test', t.home],
      ['/homes/test/organization/reservations', t.organization],
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
      assert.equal(links.length, 6);
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

test('reservations keeps all organization destinations available in a stable order', () => {
  for (const tab of ['tasks', 'shopping', 'reservations', 'absences']) {
    const html = renderToStaticMarkup(
      createElement(OrganizationNav, { homeId: 'test', locale: 'es', tab }),
    );
    const labels = Array.from(html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g), (match) =>
      match[1].replace(/<[^>]*>/g, ''),
    );
    assert.deepEqual(labels, ['Tareas', 'Compra', 'Reservas', 'Ausencias']);
    assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
  }
});

test('community configuration remains accessible outside its section tabs', () => {
  const html = renderToStaticMarkup(
    createElement(CommunityNav, { homeId: 'test', locale: 'es', tab: 'reasons' }),
  );
  const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
  assert.ok(!nav.includes('tab=reasons'));
  assert.ok(html.includes('href="/homes/test/community?tab=reasons"'));
  assert.ok(html.includes('Ajustes de puntos'));
});

test('expenses separates three routine destinations from its change history and keeps deep links active', () => {
  for (const tab of ['expenses', 'balances', 'recurring', 'history']) {
    const html = renderToStaticMarkup(
      createElement(ExpensesNav, { homeId: 'test', locale: 'es', tab }),
    );
    const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
    assert.equal((nav.match(/<a\b/g) ?? []).length, 3);
    assert.ok(!nav.includes('tab=history'));
    assert.ok(html.includes('Historial de cambios'));
    const active = (html.match(/<a\b[^>]*>/g) ?? []).filter((link) =>
      link.includes('aria-current="page"'),
    );
    assert.equal(active.length, 1);
    assert.ok(active[0].includes(`href="/homes/test/expenses?tab=${tab}"`));
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

test('organization load errors keep secondary routes and retry destination available', () => {
  const href = '/homes/test/organization?tab=absences&from=2026-10-01&create=absence';
  const html = renderToStaticMarkup(
    createElement(OrganizationLoadError, {
      homeId: 'test',
      locale: 'es',
      tab: 'absences',
      retryHref: href,
      message: 'Load failed',
    }),
  );
  assert.ok(html.includes('aria-current="page"'));
  assert.ok(html.includes('href="/homes/test/organization?tab=shopping"'));
  assert.ok(html.includes('href="/homes/test/organization/reservations"'));
  assert.ok(html.includes('href="' + href.replaceAll('&', '&amp;') + '"'));
  assert.ok(html.includes('role="alert"'));
});
