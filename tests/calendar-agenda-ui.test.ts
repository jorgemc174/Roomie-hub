import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import { createElement, type ReactNode } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { CreatePanel } from '../src/components/ui/create-panel';
import { ActivityLocationFields } from '../src/features/calendar/activity-location-fields';
import { calendarMessages } from '../src/features/calendar/messages';
import * as logic from '../src/features/calendar/logic';
import * as navigation from '../src/features/calendar/navigation';
import * as queries from '../src/features/calendar/queries';
import type { Locale } from '../src/lib/i18n/dictionaries';
import type {
  Activity,
  ActivityMember,
  CalendarManage,
  Reservation,
} from '../src/features/calendar/models';
import type { ChoreInstance } from '../src/features/organization/models';
import type { Recurring } from '../src/features/expenses/models';

type Component = (props: Record<string, unknown>) => ReactNode;
// Run the real client components with isolated framework boundaries. The calendar form and
// the response form are replaced by markers: no server action, Supabase or credentials.
async function load(path: string, dependencies: Record<string, unknown>) {
  const { outputText } = ts.transpileModule(await readFile(path, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const exports: Record<string, Component> = {};
  vm.runInNewContext(outputText, {
    exports,
    URL,
    URLSearchParams,
    require: (name: string) => {
      if (name === 'react/jsx-runtime') return jsxRuntime;
      if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name} in ${path}`);
      return dependencies[name];
    },
  });
  return exports;
}
const CalendarForm = ({
  operation,
  id,
  version = 0,
  timezone = '',
  label,
  children,
}: {
  operation: string;
  id: string;
  version?: number;
  timezone?: string;
  label: string;
  children?: ReactNode;
}) =>
  createElement(
    'form',
    {
      'data-operation': operation,
      'data-id': id,
      'data-version': String(version),
      'data-timezone': timezone,
    },
    children,
    createElement('button', { type: 'submit' }, label),
  );
const ActivityResponseForm = ({ id, response }: { id: string; response: string }) =>
  createElement('div', { 'data-response-form': id, 'data-response': response });
// Next's Link handles onNavigate itself; a plain anchor must not receive it as an attribute.
const Link = (props: { href: string; children?: ReactNode; onNavigate?: unknown }) => {
  const { href, children, ...rest } = props;
  delete rest.onNavigate;
  return createElement('a', { href, ...rest }, children);
};

async function components(query: string) {
  const common = { './messages': { calendarMessages }, './logic': logic };
  const fields = await load('src/features/calendar/fields.tsx', {
    ...common,
    react: React,
    './activity-location-fields': { ActivityLocationFields },
  });
  const cards = await load('src/features/calendar/event-card.tsx', {
    ...common,
    './form': { CalendarForm },
    './activity-response-form': { ActivityResponseForm },
    './fields': fields,
  });
  const create = await load('src/features/calendar/day-create.tsx', {
    ...common,
    '@/components/ui/create-panel': { CreatePanel },
    './form': { CalendarForm },
    './fields': fields,
  });
  const link = await load('src/features/calendar/event-link.tsx', {
    ...common,
    'next/link': { __esModule: true, default: Link },
  });
  const view = await load('src/features/calendar/calendar-view.tsx', {
    ...common,
    'next/link': { __esModule: true, default: Link },
    'next/navigation': { useSearchParams: () => new URLSearchParams(query) },
    './navigation': navigation,
    './event-link': link,
  });
  const agenda = await load('src/features/calendar/agenda.tsx', {
    ...common,
    './event-card': cards,
    './day-create': create,
    './event-link': link,
  });
  const managed = await load('src/features/calendar/managed-calendar.tsx', {
    './calendar-view': view,
    './agenda': agenda,
  });
  const list = await load('src/features/calendar/list-view.tsx', {
    ...common,
    'next/link': { __esModule: true, default: Link },
    '@/components/ui/empty-state': {
      EmptyState: ({ title }: { title: string }) => createElement('p', { 'data-empty': '' }, title),
    },
    './event-card': cards,
    './queries': queries,
  });
  return { view: view.CalendarView, managed: managed.ManagedCalendar, list: list.CalendarList };
}

const ids = {
  activity: '0b6c7d1e-1111-4111-8111-111111111111',
  otherActivity: '0b6c7d1e-2222-4222-8222-222222222222',
  washer: '1c6c7d1e-1111-4111-8111-111111111111',
  bath: '1c6c7d1e-2222-4222-8222-222222222222',
  dryer: '1c6c7d1e-3333-4333-8333-333333333333',
  laundry: '2d6c7d1e-1111-4111-8111-111111111111',
  shower: '2d6c7d1e-2222-4222-8222-222222222222',
  task: '3e6c7d1e-1111-4111-8111-111111111111',
  recurring: '4f6c7d1e-1111-4111-8111-111111111111',
  createActivity: '5a6c7d1e-1111-4111-8111-111111111111',
  createReservation: '5a6c7d1e-2222-4222-8222-222222222222',
};
const zone = 'Europe/Madrid';
const activity = {
  id: ids.activity,
  title: 'Cena de piso',
  description: 'Traed postre',
  location: 'Salón',
  location_kind: 'home',
  starts_at: '2026-11-26T19:00:00Z',
  ends_at: null,
  created_by: 'u1',
  created_by_name: 'Ana',
  cancelled_at: null,
  version: 3,
} as Activity;
const reservations = [
  {
    id: ids.laundry,
    resource_id: ids.washer,
    resource_name: 'Lavadora',
    title: 'Toallas',
    responsible_id: 'u2',
    responsible_name: 'Bea',
    starts_at: '2026-11-26T08:00:00Z',
    ends_at: '2026-11-26T09:00:00Z',
    cancelled_at: null,
    version: 2,
  },
  {
    id: ids.shower,
    resource_id: ids.bath,
    resource_name: 'Baño',
    title: '',
    responsible_id: 'u3',
    responsible_name: 'Carla',
    starts_at: '2026-11-26T10:00:00Z',
    ends_at: '2026-11-26T10:30:00Z',
    cancelled_at: null,
    version: 1,
  },
] as Reservation[];
const participants = [
  {
    activity_id: ids.activity,
    user_id: 'u1',
    user_name: 'Ana',
    response: 'going',
    attending: true,
  },
  {
    activity_id: ids.activity,
    user_id: 'u2',
    user_name: 'Bea',
    response: 'maybe',
    attending: false,
  },
  {
    activity_id: ids.activity,
    user_id: 'u3',
    user_name: 'Carla',
    response: 'not_going',
    attending: false,
  },
  {
    activity_id: ids.otherActivity,
    user_id: 'u4',
    user_name: 'Other plan person',
    response: 'going',
    attending: true,
  },
] as ActivityMember[];
const task = {
  id: ids.task,
  task_name: 'Cocina',
  period_start: '2026-11-26',
  deadline_at: '2026-11-26T21:00:00Z',
  assignee_id: 'u1',
  assignee_name: 'Ana',
  completed_at: null,
  cancelled_at: null,
} as ChoreInstance;
const recurring = {
  id: ids.recurring,
  active: true,
  next_date: '2026-11-26',
  template: { title: 'Luz', payer: 'u1', participants: [{ user_id: 'u2', weight: '1' }] },
} as unknown as Recurring;
const events = logic.normalizeCalendar(
  {
    homeId: 'h',
    tasks: [task],
    reservations,
    activities: [activity],
    members: participants,
    recurring: [recurring],
    occurrences: [],
    timezone: zone,
  },
  '2026-11-24T10:00:00Z',
);
const resources = [
  { id: ids.washer, name: 'Lavadora', active: true },
  { id: ids.bath, name: 'Baño', active: true },
  { id: ids.dryer, name: 'Secadora', active: false },
];
const people = [
  { user_id: 'u1', name: 'Ana' },
  { user_id: 'u2', name: 'Bea' },
  { user_id: 'u3', name: 'Carla' },
];
function manage(changes: Partial<CalendarManage> = {}): CalendarManage {
  return {
    activities: [activity],
    participants,
    reservations,
    resources,
    people,
    createIds: { activity: ids.createActivity, reservation: ids.createReservation },
    now: '2026-11-24T10:00:00Z',
    nowLocal: '2026-11-24T11:00:00',
    create: '',
    closeLabel: 'Cerrar',
    ...changes,
  };
}
async function render(
  locale: Locale,
  query: string,
  options: { manage?: CalendarManage | null; month?: string; selectedDay?: string } = {},
) {
  const { view, managed } = await components(query);
  // The page renders ManagedCalendar; isolated fixtures render CalendarView without it.
  return renderToStaticMarkup(
    createElement(options.manage === null ? view : managed, {
      homeId: 'h',
      month: options.month ?? '2026-11',
      selectedDay: options.selectedDay ?? '2026-11-24',
      today: '2026-11-24',
      timezone: zone,
      weekStart: 1,
      locale,
      userId: 'u1',
      events,
      manage: options.manage === null ? undefined : (options.manage ?? manage()),
    }),
  );
}
const section = (html: string, id: string) => {
  const start = html.indexOf(`id="${id}"`);
  assert.ok(start >= 0, `Missing ${id}`);
  return html.slice(start, html.indexOf('</li>', html.indexOf('</article>', start)));
};
const formOf = (html: string, operation: string, id: string) => {
  const start = html.indexOf(`data-operation="${operation}" data-id="${id}"`);
  assert.ok(start >= 0, `Missing ${operation} form for ${id}`);
  return html.slice(start, html.indexOf('</form>', start));
};

for (const locale of ['es', 'en'] as const) {
  const t = calendarMessages(locale);
  test(`the selected day manages activities and reservations in place (${locale})`, async () => {
    const html = await render(locale, 'month=2026-11&day=2026-11-26');
    assert.ok(html.includes(`id="calendar-agenda-heading"`));
    // Activity: details, exact answers, participation, editing and cancellation.
    const card = section(html, `activity-${ids.activity}`);
    for (const text of ['Cena de piso', 'Traed postre', 'Salón', `${t.creator}: Ana`, t.atHome])
      assert.ok(card.includes(text), text);
    for (const [answer, name] of [
      ['going', 'Ana'],
      ['maybe', 'Bea'],
      ['not_going', 'Carla'],
    ] as const) {
      assert.ok(card.includes(`<h5 class="font-semibold">${t[answer]} (1)</h5>`));
      assert.ok(card.includes(`<li>${name}</li>`));
    }
    assert.ok(!html.includes('Other plan person'));
    assert.ok(card.includes(`data-response-form="${ids.activity}" data-response="going"`));
    const edit = formOf(card, 'activity', ids.activity);
    assert.ok(edit.includes('data-version="3"') && edit.includes(`data-timezone="${zone}"`));
    assert.match(edit, /name="start"[^>]*value="2026-11-26T20:00:00"/);
    // Existing participants keep their answers; the creator is not offered as a participant.
    for (const person of ['u2', 'u3'])
      assert.match(
        edit,
        new RegExp(`<input(?=[^>]*value="${person}")(?=[^>]*disabled="")(?=[^>]*checked="")[^>]*>`),
      );
    assert.ok(!edit.includes('value="u1"'));
    assert.ok(formOf(card, 'cancel_activity', ids.activity).includes('name="confirm"'));
    // Reservations: details, editing while not ended and cancellation.
    const laundry = section(html, `reservation-${ids.laundry}`);
    assert.ok(laundry.includes('Lavadora · Toallas') && laundry.includes(`${t.responsible}: Bea`));
    const reservationEdit = formOf(laundry, 'reservation', ids.laundry);
    assert.ok(reservationEdit.includes('data-version="2"'));
    assert.match(reservationEdit, /name="start"[^>]*value="2026-11-26T09:00:00"/);
    assert.match(reservationEdit, /name="end"[^>]*value="2026-11-26T10:00:00"/);
    assert.ok(formOf(laundry, 'cancel_reservation', ids.laundry).includes('name="confirm"'));
    assert.ok(section(html, `reservation-${ids.shower}`).includes('Baño'));
    // Tasks and expenses keep opening their own section; former screens are not linked.
    assert.ok(
      html.includes(
        `href="/homes/h/community?tab=tasks&amp;view=all&amp;from=2026-11-26#task-${ids.task}"`,
      ),
    );
    assert.ok(html.includes(`href="/homes/h/expenses?tab=recurring#recurring-${ids.recurring}"`));
    assert.ok(!html.includes('/community/activities') && !html.includes('/organization'));
  });

  test(`creation starts from the selected day with the existing forms (${locale})`, async () => {
    const html = await render(locale, 'month=2026-11&day=2026-11-26');
    const activityPanel = html.slice(html.indexOf('id="create-activity"'));
    const create = formOf(activityPanel, 'activity', ids.createActivity);
    assert.ok(create.includes('data-version="0"') && create.includes(`data-timezone="${zone}"`));
    assert.match(create, /name="start"[^>]*value="2026-11-26T21:00:00"/);
    assert.match(create, /name="end"[^>]*value=""/);
    assert.ok(create.includes('value="u2"') && create.includes('value="u3"'));
    assert.ok(!create.includes('value="u1"'));
    const reservation = formOf(html, 'reservation', ids.createReservation);
    assert.match(reservation, /name="start"[^>]*value="2026-11-26T18:00:00"/);
    assert.match(reservation, /name="end"[^>]*value="2026-11-26T19:00:00"/);
    assert.ok(reservation.includes('Lavadora') && reservation.includes('Baño'));
    assert.ok(!reservation.includes('Secadora'));
    assert.match(reservation, /<option value="u1" selected="">Ana<\/option>/);
    assert.ok(html.includes(t.selectedDayHelp));
    // Today uses times that are still ahead of the home clock.
    const late = await render(locale, 'day=2026-11-24', {
      manage: manage({ nowLocal: '2026-11-24T20:30:00' }),
    });
    assert.match(
      formOf(late, 'activity', ids.createActivity),
      /name="start"[^>]*value="2026-11-24T21:00:00"/,
    );
    const lateReservation = formOf(late, 'reservation', ids.createReservation);
    assert.match(lateReservation, /name="start"[^>]*value="2026-11-24T21:00:00"/);
    assert.match(lateReservation, /name="end"[^>]*value="2026-11-24T22:00:00"/);
  });

  test(`deep links open a creation panel and past days only consult (${locale})`, async () => {
    const opened = await render(locale, 'day=2026-11-26&create=reservation', {
      manage: manage({ create: 'reservation' }),
    });
    assert.match(opened, /<details class="panel ui-create-panel" id="create-reservation" open="">/);
    assert.match(opened, /<details class="panel ui-create-panel" id="create-activity">/);
    const past = await render(locale, 'day=2026-11-20', {
      manage: manage({ now: '2026-11-27T10:00:00Z', nowLocal: '2026-11-27T11:00:00' }),
    });
    assert.ok(past.includes(t.pastDay));
    assert.ok(!past.includes('id="create-activity"') && !past.includes('id="create-reservation"'));
    // Ended records keep their details; reservations can no longer be edited, only cancelled.
    const ended = await render(locale, 'day=2026-11-26', {
      manage: manage({ now: '2026-11-27T10:00:00Z', nowLocal: '2026-11-27T11:00:00' }),
    });
    const card = section(ended, `activity-${ids.activity}`);
    assert.ok(!card.includes('data-response-form'));
    assert.ok(card.includes('data-operation="activity"'));
    const laundry = section(ended, `reservation-${ids.laundry}`);
    assert.ok(!laundry.includes('data-operation="reservation"'));
    assert.ok(laundry.includes('data-operation="cancel_reservation"'));
  });

  test(`resource filter narrows reservations only and creation keeps it (${locale})`, async () => {
    const html = await render(locale, `day=2026-11-26&resource=${ids.bath}`);
    assert.ok(!html.includes(`id="reservation-${ids.laundry}"`));
    assert.ok(html.includes(`id="reservation-${ids.shower}"`));
    assert.ok(html.includes(`id="activity-${ids.activity}"`));
    assert.ok(html.includes(` · Baño</summary>`));
    const create = formOf(html, 'reservation', ids.createReservation);
    assert.match(create, new RegExp(`<option value="${ids.bath}" selected="">Baño</option>`));
    const unknown = await render(locale, 'day=2026-11-26&resource=not-a-resource');
    assert.ok(unknown.includes(`id="reservation-${ids.laundry}"`));
  });

  test(`without active resources the reservation panel offers the defaults (${locale})`, async () => {
    const html = await render(locale, 'day=2026-11-26', {
      manage: manage({ resources: resources.map((x) => ({ ...x, active: false })) }),
    });
    const panel = html.slice(html.indexOf('id="create-reservation"'));
    assert.ok(panel.includes(t.noResources) && panel.includes('data-operation="initialize"'));
    assert.ok(!html.includes(`data-operation="reservation" data-id="${ids.createReservation}"`));
    assert.ok(html.includes(`data-operation="activity" data-id="${ids.createActivity}"`));
  });

  test(`without management data the agenda keeps read-only links (${locale})`, async () => {
    const html = await render(locale, 'day=2026-11-26', { manage: null });
    assert.ok(!html.includes('create-activity') && !html.includes('data-operation'));
    assert.ok(
      html.includes(
        `href="/homes/h/calendar?month=2026-11&amp;day=2026-11-26&amp;item=${ids.activity}#activity-${ids.activity}"`,
      ),
    );
  });

  test(`upcoming and history lists keep kinds, filters and pagination (${locale})`, async () => {
    const { list } = await components('');
    const common = {
      homeId: 'h',
      locale,
      timezone: zone,
      userId: 'u1',
      now: '2026-11-24T10:00:00Z',
      resources,
      people,
      participants,
      activities: [],
    };
    const html = renderToStaticMarkup(
      createElement(list, {
        ...common,
        view: 'upcoming',
        kind: 'reservations',
        resource: ids.bath,
        page: 1,
        hasMore: true,
        reservations,
      }),
    );
    assert.ok(html.includes(`${t.upcoming} · ${t.reservations}`));
    assert.match(
      html,
      new RegExp(
        `href="/homes/h/calendar\\?view=upcoming&amp;kind=reservations&amp;resource=${ids.bath}&amp;page=2"`,
      ),
    );
    assert.match(
      html,
      new RegExp(
        `href="/homes/h/calendar\\?view=upcoming&amp;kind=reservations&amp;resource=${ids.bath}"`,
      ),
    );
    assert.ok(html.includes('href="/homes/h/calendar?view=upcoming&amp;kind=activities"'));
    assert.ok(html.includes('<input type="hidden" name="view" value="upcoming"/>'));
    assert.match(html, new RegExp(`<option value="${ids.bath}" selected="">Baño</option>`));
    assert.ok(html.includes(`id="reservation-${ids.laundry}"`));
    const focused = renderToStaticMarkup(
      createElement(list, {
        ...common,
        view: 'history',
        kind: 'activities',
        resource: '',
        item: ids.activity,
        page: 0,
        hasMore: false,
        activities: [{ ...activity, cancelled_at: '2026-11-25T10:00:00Z' }],
        reservations: [],
      }),
    );
    assert.ok(focused.includes(`${t.history} · ${t.activities}`));
    assert.ok(focused.includes(t.allHistory) && focused.includes(t.cancelled));
    assert.ok(!focused.includes('data-operation="activity"'));
    assert.ok(!focused.includes('aria-current'));
    const empty = renderToStaticMarkup(
      createElement(list, {
        ...common,
        view: 'history',
        kind: 'activities',
        resource: '',
        page: 0,
        hasMore: false,
        reservations: [],
      }),
    );
    assert.ok(empty.includes(t.noActivities) && !empty.includes(t.pages));
  });
}
