import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { createElement, type ReactNode } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { calendarMessages } from '../src/features/calendar/messages';
import { ActivityLocationFields } from '../src/features/calendar/activity-location-fields';
import * as logic from '../src/features/calendar/logic';
import type { Locale } from '../src/lib/i18n/dictionaries';
import type { ActivityMember } from '../src/features/calendar/models';

// Render the actual server page with isolated reads, without credentials or business writes.
async function renderActivity(
  locale: Locale,
  responses: ActivityMember['response'][],
  history = false,
) {
  const members = responses.map((response, index) => ({
    activity_id: 'plan',
    user_id: `user-${index}`,
    user_name: `Person ${index}`,
    response,
  }));
  const wrapper = ({ children }: { children: ReactNode }) => createElement('div', null, children);
  const dependencies: Record<string, unknown> = {
    '@/components/ui/create-panel': { CreatePanel: wrapper },
    '@/components/ui/empty-state': { EmptyState: () => null },
    '@/components/ui/page-header': { PageHeader: () => null },
    '@/features/community/nav': { CommunityNav: () => null, CommunityOptions: wrapper },
    'next/link': { default: wrapper },
    '@/lib/data': {
      getHome: async () => ({ timezone: 'UTC' }),
      getMembers: async () => [],
      requireUser: async () => ({
        user: { id: 'user-0' },
        db: {
          from: () => ({
            select: () => ({ eq: () => ({ limit: async () => ({ error: null }) }) }),
          }),
        },
      }),
    },
    '@/lib/i18n/server': { i18n: async () => ({ locale, t: { closePanel: 'Close' } }) },
    '@/lib/timezones': { homeDate: () => '2026-11-04' },
    '@/features/organization/logic': { addDays: () => '2026-11-05' },
    './queries': {
      calendarItem: () => undefined,
      calendarPageIndex: () => 0,
      readActivityPage: async () => ({
        rows: [
          {
            id: 'plan',
            title: 'Shared plan',
            description: 'Description',
            location: 'Living room',
            location_kind: 'home',
            created_by: 'user-0',
            created_by_name: 'Creator',
            starts_at: history ? '2000-01-01T21:00:00Z' : '2099-01-01T21:00:00Z',
            ends_at: null,
            cancelled_at: null,
            version: 1,
          },
        ],
        hasMore: false,
      }),
      readActivityMembers: async () => [
        ...members,
        {
          activity_id: 'other-plan',
          user_id: 'other',
          user_name: 'Other plan person',
          response: 'going',
        },
      ],
    },
    './messages': { calendarMessages },
    './form': { CalendarForm: wrapper },
    './activity-location-fields': { ActivityLocationFields },
    './logic': logic,
  };
  const { outputText } = ts.transpileModule(
    await readFile('src/features/calendar/activities-page.tsx', 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  );
  const exports: {
    ActivitiesPage?: (props: {
      homeId: string;
      search: Record<string, string>;
    }) => Promise<ReactNode>;
  } = {};
  vm.runInNewContext(outputText, {
    exports,
    crypto,
    require: (name: string) => {
      if (name === 'react/jsx-runtime') return jsxRuntime;
      if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  const html = renderToStaticMarkup(
    await exports.ActivitiesPage!({ homeId: 'home', search: history ? { view: 'history' } : {} }),
  );
  return html.slice(html.indexOf('<article'), html.indexOf('</article>') + '</article>'.length);
}

for (const locale of ['es', 'en'] as const) {
  for (const [name, responses] of [
    ['mixed responses', ['going', 'maybe', 'not_going', 'going', 'not_going', 'going']],
    ['zero responses', []],
    [
      'full list',
      Array.from({ length: 75 }, (_, i) => (['going', 'maybe', 'not_going'] as const)[i % 3]),
    ],
  ] as const) {
    test(`PA1269: ${name} keeps exact counters and complete names (${locale})`, async () => {
      for (const history of [false, true]) {
        const html = await renderActivity(locale, [...responses], history);
        const t = calendarMessages(locale);
        assert.ok(html.includes(`${t.creator}: Creator`));
        assert.ok(!html.includes('Other plan person'));
        for (const answer of ['going', 'maybe', 'not_going'] as const) {
          const names = responses.flatMap((response, i) =>
            response === answer ? [`Person ${i}`] : [],
          );
          const heading = `<h4>${t[answer]} (${new Intl.NumberFormat(locale).format(names.length)})</h4>`;
          assert.ok(html.includes(heading), `Missing visible counter: ${heading}`);
          const group = html.slice(
            html.indexOf(heading),
            html.indexOf('</section>', html.indexOf(heading)),
          );
          assert.equal((group.match(/<li>/g) ?? []).length, names.length);
          for (const person of names) assert.ok(group.includes(`<li>${person}</li>`));
          if (!names.length) assert.ok(group.includes(t.noResponses));
        }
      }
    });
  }
}
