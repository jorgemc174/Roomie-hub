import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { createElement, type ReactNode } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { calendarMessages } from '../src/features/calendar/messages';
import * as logic from '../src/features/calendar/logic';
import type { Locale } from '../src/lib/i18n/dictionaries';
import type { ParticipantView } from '../src/features/calendar/models';

// Activities are now managed inside the calendar agenda: render the real activity card with
// isolated forms, without credentials, Supabase reads or business writes.
async function renderActivity(
  locale: Locale,
  responses: ParticipantView['response'][],
  history = false,
) {
  const participants = responses.map((response, index) => ({
    activity_id: 'plan',
    user_id: `user-${index}`,
    user_name: `Person ${index}`,
    response,
  }));
  const wrapper = ({ children }: { children?: ReactNode }) => createElement('div', null, children);
  const dependencies: Record<string, unknown> = {
    './form': { CalendarForm: wrapper },
    './activity-response-form': { ActivityResponseForm: () => null },
    './fields': { ActivityFields: () => null, ReservationFields: () => null },
    './messages': { calendarMessages },
    './logic': logic,
  };
  const { outputText } = ts.transpileModule(
    await readFile('src/features/calendar/event-card.tsx', 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  );
  const exports: { ActivityCard?: (props: Record<string, unknown>) => ReactNode } = {};
  vm.runInNewContext(outputText, {
    exports,
    require: (name: string) => {
      if (name === 'react/jsx-runtime') return jsxRuntime;
      if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  const html = renderToStaticMarkup(
    createElement(exports.ActivityCard!, {
      homeId: 'home',
      locale,
      timezone: 'UTC',
      userId: 'user-0',
      now: '2026-11-04T12:00:00Z',
      activity: {
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
      participants: [
        ...participants,
        {
          activity_id: 'other-plan',
          user_id: 'other',
          user_name: 'Other plan person',
          response: 'going',
        },
      ],
      people: [],
    }),
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
          const heading = `<h5 class="font-semibold">${t[answer]} (${new Intl.NumberFormat(locale).format(names.length)})</h5>`;
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
