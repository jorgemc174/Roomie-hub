import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { Navigation } from '../src/components/navigation';
import { OrganizationNav, OrganizationLoadError } from '../src/features/organization/nav';
import { CommunityNav } from '../src/features/community/nav';
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
  assert.ok(html.includes('Configurar motivos'));
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
