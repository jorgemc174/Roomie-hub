import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { createElement, type ReactNode } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { CreatePanel } from '../src/components/ui/create-panel';
import { OptionsMenu } from '../src/components/ui/options-menu';
import { PageHeader } from '../src/components/ui/page-header';
import { SectionDisclosure } from '../src/components/section-disclosure';
import { EmptyState } from '../src/components/ui/empty-state';
import { formatInstant } from '../src/features/calendar/logic';
import { communityMessages } from '../src/features/community/messages';
import * as nav from '../src/features/community/nav';
import * as models from '../src/features/community/models';
import { CommunityRanking } from '../src/features/community/ranking';
import { noticeHref } from '../src/features/notifications/models';
import { PunishmentDescription } from '../src/features/community/punishment-description';
import type { Locale } from '../src/lib/i18n/dictionaries';

// Render the real async Server Components with in-memory reads; no Supabase or Next server.
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

const homeId = '11111111-1111-4111-8111-111111111111',
  me = '22222222-2222-4222-8222-222222222222',
  other = '33333333-3333-4333-8333-333333333333';

const balance = (user_id: string, user_name: string, pending: number): models.CommunityBalance => ({
  user_id,
  user_name,
  active: true,
  positive_available: 0,
  positive_history: 0,
  positive_consumed: 0,
  negative_effective: 5,
  negative_history: 5,
  credits: 0,
  pending_punishments: pending,
});

const punishment = (
  id: string,
  user_id: string,
  threshold: number,
  description = '',
  done = false,
) => ({
  id,
  home_id: homeId,
  user_id,
  user_name: user_id === me ? 'Jorge' : 'Ana',
  threshold,
  severity: threshold % 10 === 0 ? 'heavy' : 'light',
  description,
  triggered_at: '2026-11-20T10:00:00Z',
  completed_at: done ? '2026-11-21T10:00:00Z' : null,
  completed_by: done ? other : null,
  completed_by_name: done ? 'Ana' : null,
  version: 1,
});

function db(balances: models.CommunityBalance[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'is', 'order', 'range']) chain[method] = () => chain;
  chain.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(resolve({ data: [], error: null }));
  return {
    rpc: async (name: string) =>
      name === 'community_balances'
        ? { data: balances, error: null }
        : { data: { more: false }, error: null },
    from: () => chain,
  };
}

function FakeForm({
  operation,
  label,
  children,
}: {
  operation: string;
  label: string;
  children?: ReactNode;
}) {
  return createElement(
    'form',
    { 'data-operation': operation },
    children,
    createElement('button', null, label),
  );
}

async function renderPage(
  locale: Locale,
  rows: ReturnType<typeof punishment>[],
  presets: models.PunishmentPreset[] | null = [],
  tab = 'punishments',
) {
  const balances = [balance(me, 'Jorge', 2), balance(other, 'Ana', 0)];
  const { CommunityPage } = await component<{
    CommunityPage: (props: {
      homeId: string;
      search: Record<string, string>;
    }) => Promise<ReactNode>;
  }>('src/features/community/page.tsx', {
    '@/components/ui/create-panel': { CreatePanel },
    '@/components/ui/options-menu': { OptionsMenu },
    '@/components/ui/page-header': { PageHeader },
    '@/components/section-disclosure': { SectionDisclosure },
    '@/components/ui/empty-state': { EmptyState },
    'next/link': { default: Link },
    '@/lib/data': {
      getHome: async () => ({ id: homeId, timezone: 'Europe/Madrid' }),
      getMembers: async () => [],
      requireUser: async () => ({ user: { id: me }, db: db(balances) }),
      signedImage: async () => null,
    },
    '@/lib/i18n/server': { i18n: async () => ({ locale, t: {} }) },
    './queries': {
      readCommunityRows: async () => ({ reasons: [], punishments: rows, redemptions: [], presets }),
    },
    '@/features/calendar/logic': { formatInstant },
    './messages': { communityMessages },
    './form': { CommunityForm: FakeForm, RatingFields: () => null },
    './punishment-description': { PunishmentDescription },
    './nav': nav,
    './ranking': { CommunityRanking },
    './models': models,
  });
  return renderToStaticMarkup(
    createElement('div', null, await CommunityPage({ homeId, search: { tab } })),
  );
}

test('pending consequences offer a direct define action, then mark completed; history stays read-only', async () => {
  for (const locale of ['es', 'en'] as const) {
    const t = communityMessages(locale);
    const html = await renderPage(locale, [
      punishment('aaaaaaaa-0000-4000-8000-000000000005', me, 5),
      punishment('aaaaaaaa-0000-4000-8000-000000000010', me, 10, 'Limpiar el baño'),
      punishment('aaaaaaaa-0000-4000-8000-000000000015', other, 15, 'Fregar', true),
    ]);
    const card = (id: string) => {
      const start = html.indexOf(`id="punishment-aaaaaaaa-0000-4000-8000-0000000000${id}"`);
      return html.slice(start, html.indexOf('</article>', start));
    };
    const undefinedCard = card('05'),
      definedCard = card('10'),
      doneCard = card('15');
    assert.ok(undefinedCard.includes(`${t.threshold}: 5 ${t.negativesUnit}`));
    assert.ok(undefinedCard.includes(`<summary class="button">${t.defineAction}</summary>`));
    assert.ok(undefinedCard.includes('name="description" maxLength="2000" required=""'));
    // Consequences already written in the home are offered again, without the card's own text.
    assert.ok(undefinedCard.includes(`aria-label="${t.savedPunishments}"`));
    assert.ok(undefinedCard.includes('>Limpiar el baño</button>'));
    assert.ok(undefinedCard.includes('>Fregar</button>'));
    assert.ok(definedCard.includes('>Fregar</button>'));
    assert.ok(!definedCard.includes('>Limpiar el baño</button>'));
    assert.ok(!undefinedCard.includes('ui-options-menu'));
    assert.ok(!undefinedCard.includes(t.finish));
    assert.ok(definedCard.includes(t.heavy));
    assert.ok(definedCard.includes('ui-options-menu'));
    assert.ok(definedCard.includes(`<button>${t.finish}</button>`));
    assert.ok(definedCard.includes('name="finish" value="on"'));
    assert.ok(!definedCard.includes(t.defineAction));
    assert.ok(doneCard.includes(`${t.completedBy}: Ana`));
    assert.ok(!doneCard.includes('<form'));
    assert.ok(html.indexOf(`<h2>${t.pending}</h2>`) < html.indexOf(`<h2>${t.completed}</h2>`));
  }
});

test('Home summary links pending consequences to the own filtered list', async () => {
  for (const locale of ['es', 'en'] as const) {
    const t = communityMessages(locale);
    for (const pending of [0, 2]) {
      const { CommunitySummary } = await component<{
        CommunitySummary: (props: { homeId: string }) => Promise<ReactNode>;
      }>('src/features/community/summary.tsx', {
        'next/link': { default: Link },
        'lucide-react': { Sparkles },
        '@/lib/data': {
          requireUser: async () => ({ user: { id: me }, db: db([balance(me, 'Jorge', pending)]) }),
        },
        '@/lib/i18n/server': { i18n: async () => ({ locale }) },
        './messages': { communityMessages },
      });
      const html = renderToStaticMarkup(
        createElement('div', null, await CommunitySummary({ homeId })),
      );
      const link = `href="/homes/${homeId}/community?tab=punishments&amp;person=${me}"`;
      assert.equal(html.includes(link), pending > 0);
      assert.equal(html.includes(t.viewPunishments), pending > 0);
    }
  }
});

test('ranking links pending consequences to that member list', () => {
  const html = renderToStaticMarkup(
    createElement(CommunityRanking, {
      homeId,
      locale: 'es',
      balances: [balance(me, 'Jorge', 2), balance(other, 'Ana', 0)],
      currentUserId: me,
      avatars: {},
    }),
  );
  assert.ok(html.includes(`href="/homes/${homeId}/community?tab=punishments&amp;person=${me}"`));
  assert.ok(!html.includes(`tab=punishments&amp;person=${other}`));
});

test('consequence notices open the exact consequence; others keep their stored route', () => {
  const source = 'aaaaaaaa-0000-4000-8000-000000000005';
  assert.equal(
    noticeHref({
      home_id: homeId,
      source_table: 'punishments',
      source_id: source,
      target_url: `/homes/${homeId}/community`,
    }),
    `/homes/${homeId}/community?tab=punishments#punishment-${source}`,
  );
  assert.equal(
    noticeHref({
      home_id: homeId,
      source_table: 'ratings',
      source_id: source,
      target_url: `/homes/${homeId}/community`,
    }),
    `/homes/${homeId}/community`,
  );
  assert.equal(
    noticeHref({
      home_id: '../x',
      source_table: 'punishments',
      source_id: source,
      target_url: `/homes/${homeId}/community`,
    }),
    `/homes/${homeId}/community`,
  );
});

test('saved consequences are unique, reusable and ordered by severity, use and recency', () => {
  const row = (description: string, severity: 'light' | 'heavy', day: number) => ({
    description,
    severity,
    triggered_at: `2026-11-${String(day).padStart(2, '0')}T10:00:00Z`,
  });
  const rows = [
    row('Fregar', 'light', 1),
    row('  fregar ', 'light', 3),
    row('Limpiar   el baño', 'heavy', 2),
    row('', 'light', 4),
    row('Bajar la basura', 'light', 5),
  ];
  assert.deepEqual(models.savedPunishments(rows, 'light'), [
    { text: 'fregar', severity: 'light', uses: 2 },
    { text: 'Bajar la basura', severity: 'light', uses: 1 },
    { text: 'Limpiar el baño', severity: 'heavy', uses: 1 },
  ]);
  assert.equal(models.savedPunishments(rows, 'heavy')[0].text, 'Limpiar el baño');
  assert.equal(models.savedPunishments(rows, 'light', 1).length, 1);
  assert.deepEqual(models.savedPunishments([]), []);
});

test('choosing a saved consequence fills the description in es/en', () => {
  for (const locale of ['es', 'en'] as const) {
    const t = communityMessages(locale);
    const html = renderToStaticMarkup(
      createElement(PunishmentDescription, {
        locale,
        saved: [
          { text: 'Fregar', severity: 'light', uses: 3 },
          { text: 'Limpiar el baño', severity: 'heavy', uses: 1 },
        ],
        defaultValue: 'Fregar',
      }),
    );
    assert.ok(html.includes(t.savedPunishments));
    assert.ok(!html.includes('>Fregar</button>'));
    assert.ok(
      html.includes(
        `type="button" class="button secondary" title="${t.heavy}">Limpiar el baño</button>`,
      ),
    );
    assert.ok(html.includes('>Fregar</textarea>'));
    const empty = renderToStaticMarkup(
      createElement(PunishmentDescription, { locale, saved: [], required: true }),
    );
    assert.ok(!empty.includes(t.savedPunishments));
    assert.ok(empty.includes('required=""'));
  }
});

const preset = (
  id: string,
  description: string,
  severity: 'light' | 'heavy' | null,
): models.PunishmentPreset => ({
  id,
  home_id: homeId,
  description,
  severity,
  version: 2,
  created_at: '2026-11-26T10:00:00Z',
});

test('predefined consequences come first when defining, filtered by severity, with a manage link', async () => {
  for (const locale of ['es', 'en'] as const) {
    const t = communityMessages(locale);
    const html = await renderPage(
      locale,
      [
        punishment('aaaaaaaa-0000-4000-8000-000000000005', me, 5),
        punishment('aaaaaaaa-0000-4000-8000-000000000015', other, 15, 'Fregar', true),
      ],
      [
        preset('bbbbbbbb-0000-4000-8000-000000000001', 'Bajar la basura', null),
        preset('bbbbbbbb-0000-4000-8000-000000000002', 'Limpiar el horno', 'heavy'),
        preset('bbbbbbbb-0000-4000-8000-000000000003', 'Fregar', 'light'),
      ],
    );
    const start = html.indexOf('id="punishment-aaaaaaaa-0000-4000-8000-000000000005"');
    const card = html.slice(start, html.indexOf('</article>', start));
    const buttons = Array.from(
      card.matchAll(/<button type="button" class="([^"]+)"[^>]*>([^<]+)<\/button>/g),
      (m) => [m[1], m[2]],
    );
    assert.deepEqual(buttons, [
      ['button secondary is-preset', 'Fregar'],
      ['button secondary is-preset', 'Bajar la basura'],
    ]);
    assert.ok(!card.includes('Limpiar el horno'));
    assert.ok(card.includes(`href="/homes/${homeId}/community?tab=reasons#punishment-presets"`));
    assert.ok(card.includes(t.managePresets));
    assert.ok(!html.includes(t.noPending));
    const none = await renderPage(locale, [], []);
    assert.ok(none.includes(t.noPending));
    assert.ok(none.includes(`href="/homes/${homeId}/community?tab=reasons#punishment-presets"`));
    assert.ok(none.includes(t.addPreset));
    assert.equal((none.match(/data-operation="preset"/g) ?? []).length, 1);
    assert.ok(none.indexOf(t.addPreset) < none.indexOf(t.noPending));
    const unavailable = await renderPage(locale, [], null);
    assert.ok(unavailable.includes(t.presetsMigration));
    assert.ok(!unavailable.includes('data-operation="preset"'));
  }
});

test('Ajustes de puntos manages predefined consequences, and explains a missing migration', async () => {
  for (const locale of ['es', 'en'] as const) {
    const t = communityMessages(locale);
    const html = await renderPage(
      locale,
      [],
      [
        preset('bbbbbbbb-0000-4000-8000-000000000001', 'Bajar la basura', null),
        preset('bbbbbbbb-0000-4000-8000-000000000002', 'Limpiar el horno', 'heavy'),
      ],
      'reasons',
    );
    const section = html.slice(html.indexOf('id="punishment-presets"'));
    assert.ok(section.includes(`<h2>${t.presets}</h2>`));
    assert.ok(section.includes(`<summary>${t.newPreset}</summary>`));
    assert.equal((section.match(/data-operation="preset"/g) ?? []).length, 3);
    assert.equal((section.match(/data-operation="preset-delete"/g) ?? []).length, 2);
    assert.ok(section.includes('required="" name="confirm"'));
    assert.ok(section.includes(t.confirmPreset));
    assert.ok(section.includes('maxLength="500"'));
    assert.ok(section.includes(`<option value="heavy" selected="">${t.heavyOnly}</option>`));
    assert.ok(section.includes(`<p class="badge punishment">${t.anySeverity}</p>`));
    assert.ok(section.includes(`<p class="badge punishment">${t.heavyOnly}</p>`));
    const empty = await renderPage(locale, [], [], 'reasons');
    assert.ok(empty.includes(t.presetsEmpty));
    const missing = await renderPage(locale, [], null, 'reasons');
    assert.ok(missing.includes(t.presetsMigration));
    assert.ok(!missing.includes('data-operation="preset"'));
  }
});

test('suggestions put matching presets before history and never repeat a text', () => {
  const history = [
    { description: 'fregar', severity: 'light' as const, triggered_at: '2026-11-01T10:00:00Z' },
    {
      description: 'Pasear al perro',
      severity: 'light' as const,
      triggered_at: '2026-11-02T10:00:00Z',
    },
  ];
  assert.deepEqual(
    models.punishmentSuggestions(
      [
        { description: 'Bajar la basura', severity: null },
        { description: 'Fregar', severity: 'light' },
        { description: 'Limpiar el horno', severity: 'heavy' },
      ],
      history,
      'light',
    ),
    [
      { text: 'Fregar', severity: 'light', uses: 0, preset: true },
      { text: 'Bajar la basura', severity: null, uses: 0, preset: true },
      { text: 'Pasear al perro', severity: 'light', uses: 1 },
    ],
  );
});
