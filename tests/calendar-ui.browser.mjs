// Browser regression for the calendar after Actividades/Reservas moved into it.
// Real calendar components and CSS; the server action is replaced by an in-page recorder,
// so no Supabase, credentials or business writes are involved. Run `pnpm build` first.
import { createRequire } from 'node:module';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, readdir, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('tsx'))('esbuild');
const root = process.cwd(),
  temp = await mkdtemp(path.join(tmpdir(), 'roomie-calendar-'));
const router = path.join(root, 'tests/fixtures/navigation/router.tsx');
const stubs = {
  name: 'calendar-stubs',
  setup(builder) {
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'stub' }));
    builder.onResolve({ filter: /^\.\/actions$/ }, (args) =>
      args.importer.includes(path.join('src', 'features', 'calendar'))
        ? { path: 'actions', namespace: 'stub' }
        : undefined,
    );
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
      contents:
        args.path === 'link'
          ? `export default function Link({ children, onNavigate, prefetch, ...props }) {
               return <a {...props} onClick={(event) => { onNavigate?.(event); }}>{children}</a>;
             }
             export const useLinkStatus = () => ({ pending: false });`
          : `export async function calendarAction(homeId, operation, _state, form) {
               const entry = { homeId, operation };
               for (const key of new Set(form.keys())) {
                 const values = form.getAll(key).map(String);
                 entry[key] = values.length > 1 ? values : values[0];
               }
               (window.calendarCalls ||= []).push(entry);
               return { success: document.documentElement.lang === 'en' ? 'Saved. Reload to continue.' : 'Guardado. Recarga para continuar.' };
             }`,
      loader: 'tsx',
      resolveDir: root,
    }));
  },
};
const fixture = `
  import { createRoot } from 'react-dom/client';
  import { ManagedCalendar } from './src/features/calendar/managed-calendar';
  import { normalizeCalendar } from './src/features/calendar/logic';
  for (const method of ['pushState', 'replaceState']) {
    const original = window.history[method].bind(window.history);
    window.history[method] = (data, unused, url) => {
      original(data, unused, url);
      window.dispatchEvent(new Event('fixture:history'));
    };
  }
  const locale = document.documentElement.lang === 'en' ? 'en' : 'es';
  const zone = 'Europe/Madrid';
  const activity = { id: '0b6c7d1e-1111-4111-8111-111111111111', title: 'Cena de piso', description: 'Traed postre', location: 'Salón', location_kind: 'home', starts_at: '2026-11-26T19:00:00Z', ends_at: null, created_by: 'u1', created_by_name: 'Ana', cancelled_at: null, version: 3 };
  const reservations = [
    { id: '2d6c7d1e-1111-4111-8111-111111111111', resource_id: '1c6c7d1e-1111-4111-8111-111111111111', resource_name: 'Lavadora', title: 'Toallas', responsible_id: 'u2', responsible_name: 'Bea', starts_at: '2026-11-26T08:00:00Z', ends_at: '2026-11-26T09:00:00Z', cancelled_at: null, version: 2 },
    { id: '2d6c7d1e-2222-4222-8222-222222222222', resource_id: '1c6c7d1e-2222-4222-8222-222222222222', resource_name: 'Baño', title: '', responsible_id: 'u3', responsible_name: 'Carla Fernández de la Peña', starts_at: '2026-11-26T10:00:00Z', ends_at: '2026-11-26T10:30:00Z', cancelled_at: null, version: 1 },
  ];
  const participants = [
    { activity_id: activity.id, user_id: 'u1', user_name: 'Ana', response: 'going', attending: true },
    { activity_id: activity.id, user_id: 'u2', user_name: 'Bea', response: 'maybe', attending: false },
    { activity_id: activity.id, user_id: 'u3', user_name: 'Carla Fernández de la Peña', response: 'not_going', attending: false },
  ];
  const task = { id: '3e6c7d1e-1111-4111-8111-111111111111', task_name: 'Cocina', period_start: '2026-11-26', deadline_at: '2026-11-26T21:00:00Z', assignee_id: 'u1', assignee_name: 'Ana', completed_at: null, cancelled_at: null };
  const events = normalizeCalendar({ homeId: 'demo', tasks: [task], reservations, activities: [activity], members: participants, recurring: [], occurrences: [], timezone: zone }, '2026-11-24T10:00:00Z');
  const search = new URLSearchParams(location.search);
  const month = search.get('month') || '2026-11';
  createRoot(document.getElementById('root')).render(
    <div className="app-shell"><aside className="sidebar" aria-label="Sidebar placeholder" /><div className="workspace"><main className="page" id="main"><div className="organization">
      <h1>{locale === 'en' ? 'Calendar' : 'Calendario'}</h1>
      <ManagedCalendar homeId="demo" month={month} selectedDay="2026-11-24" today="2026-11-24" timezone={zone} weekStart={1} locale={locale} userId="u1" events={events}
        manage={{ activities: [activity], participants, reservations, resources: [
          { id: '1c6c7d1e-1111-4111-8111-111111111111', name: 'Lavadora', active: true },
          { id: '1c6c7d1e-2222-4222-8222-222222222222', name: 'Baño', active: true },
          { id: '1c6c7d1e-3333-4333-8333-333333333333', name: 'Secadora', active: false },
        ], people: [{ user_id: 'u1', name: 'Ana' }, { user_id: 'u2', name: 'Bea' }, { user_id: 'u3', name: 'Carla Fernández de la Peña' }],
          createIds: { activity: '5a6c7d1e-1111-4111-8111-111111111111', reservation: '5a6c7d1e-2222-4222-8222-222222222222' },
          now: '2026-11-24T10:00:00Z', nowLocal: '2026-11-24T11:00:00', create: search.get('create') || '', closeLabel: locale === 'en' ? 'Close' : 'Cerrar' }} />
    </div></main></div></div>,
  );`;
const outfile = path.join(temp, 'calendar.js'),
  navigationFile = path.join(temp, 'navigation.js');
await build({
  stdin: { resolveDir: root, loader: 'tsx', contents: fixture },
  outfile,
  bundle: true,
  jsx: 'automatic',
  platform: 'browser',
  alias: { 'next/navigation': router },
  plugins: [stubs],
  define: { 'process.env.NODE_ENV': '"production"' },
});
// The shared navigation fixture must still bundle CalendarView without server actions.
await build({
  entryPoints: ['tests/fixtures/navigation/app.tsx'],
  outfile: navigationFile,
  bundle: true,
  platform: 'browser',
  alias: { 'next/navigation': router },
  define: { 'process.env.NODE_ENV': '"production"' },
});
const chunks = await readdir('.next/static/chunks').catch(() => {
  throw new Error('Run pnpm build before the calendar browser tests.');
});
const css = (
  await Promise.all(
    chunks
      .filter((x) => x.endsWith('.css'))
      .map((x) => readFile(`.next/static/chunks/${x}`, 'utf8')),
  )
).join('\n');
const files = {
  '/calendar.js': await readFile(outfile),
  '/navigation.js': await readFile(navigationFile),
};
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (files[url.pathname]) {
    res.setHeader('Content-Type', 'application/javascript');
    return res.end(files[url.pathname]);
  }
  if (url.pathname === '/fixture.css') {
    res.setHeader('Content-Type', 'text/css');
    return res.end(css);
  }
  const script = url.searchParams.has('calendar') ? '/navigation.js' : '/calendar.js';
  res.setHeader('Content-Type', 'text/html');
  res.end(
    `<!doctype html><html lang="${url.searchParams.get('locale') === 'en' ? 'en' : 'es'}" data-theme="${url.searchParams.get('theme') === 'dark' ? 'dark' : 'light'}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script>globalThis.process={env:{NODE_ENV:"production"}};</script><script src="${script}"></script></body></html>`,
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const screenshots = process.env.CALENDAR_SCREENSHOTS_DIR;
if (screenshots) await mkdir(screenshots, { recursive: true });
const ids = {
  activity: '0b6c7d1e-1111-4111-8111-111111111111',
  laundry: '2d6c7d1e-1111-4111-8111-111111111111',
  shower: '2d6c7d1e-2222-4222-8222-222222222222',
  bath: '1c6c7d1e-2222-4222-8222-222222222222',
};
let browser,
  scenarios = 0;
try {
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  });
  // Same calendar history scenario as scripts/test-navigation-ui.mjs, on its shared fixture.
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${origin}/?calendar=1&month=2026-10`);
    const day = (value) =>
      page.locator('button.calendar-day').filter({ hasText: new RegExp(`^${value}$`) });
    const historyLength = await page.evaluate(() => history.length);
    await day(15).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('day')).toBe('2026-10-15');
    await page.locator('.calendar-filter-panel > summary').click();
    await page.getByLabel('Solo lo mío', { exact: true }).check();
    await page.getByLabel('Gastos', { exact: true }).uncheck();
    await page.reload();
    await expect(page.locator('.calendar-day.selected')).toHaveText('15');
    await day(20).click();
    await expect(page.locator('.calendar-day.selected')).toHaveText('20');
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
    const next = new URL(
      await page.getByRole('link', { name: 'Mes siguiente', exact: true }).getAttribute('href'),
      origin,
    );
    expect(next.searchParams.get('mine')).toBe('1');
    expect(next.searchParams.get('types')).not.toContain('expenses');
    expect(errors).toEqual([]);
    await page.close();
    scenarios++;
  }
  for (const width of [320, 390, 768, 1440])
    for (const theme of ['light', 'dark'])
      for (const locale of ['es', 'en']) {
        const es = locale === 'es';
        const page = await browser.newPage({
          viewport: { width, height: 900 },
          reducedMotion: 'reduce',
        });
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
        await page.goto(`${origin}/?month=2026-11&day=2026-11-26&theme=${theme}&locale=${locale}`);
        const day = (value) =>
          page.locator('button.calendar-day:not([disabled])').filter({
            has: page.locator('span:first-child', { hasText: new RegExp(`^${value}$`) }),
          });
        const card = page.locator(`#activity-${ids.activity}`);
        await expect(card).toContainText('Cena de piso');
        await expect(page.locator(`#reservation-${ids.laundry}`)).toContainText(
          'Lavadora · Toallas',
        );
        await expect(page.locator('a[href*="/community?tab=tasks"]')).toHaveCount(1);
        expect(
          await page.locator('a[href*="/organization"], a[href*="/community/activities"]').count(),
        ).toBe(0);
        if (screenshots)
          await page.screenshot({
            path: path.join(screenshots, `${width}-${theme}-${locale}-agenda.png`),
            fullPage: true,
          });
        // Creation follows the selected day while a draft keeps its typed values.
        const create = page.locator('#create-activity');
        await create.locator(':scope > summary').click();
        const start = create.locator('input[name="start"]');
        await expect(start).toHaveValue(/^2026-11-26T21:00(:00)?$/);
        await create.locator('input[name="title"]').fill('Cena de prueba');
        await create.locator('select[name="location_kind"]').selectOption('home');
        await create.getByLabel('Bea', { exact: true }).check();
        const historyLength = await page.evaluate(() => history.length);
        await day(27).click();
        await expect(start).toHaveValue(/^2026-11-27T21:00(:00)?$/);
        await expect(create.locator('input[name="title"]')).toHaveValue('Cena de prueba');
        expect(new URL(page.url()).searchParams.get('day')).toBe('2026-11-27');
        expect(await page.evaluate(() => history.length)).toBe(historyLength);
        await start.fill('2026-11-30T20:00');
        await day(28).click();
        await expect(start).toHaveValue(/^2026-11-30T20:00(:00)?$/);
        if (screenshots)
          await page.screenshot({
            path: path.join(screenshots, `${width}-${theme}-${locale}-create.png`),
            fullPage: true,
          });
        await create.locator('form > button.button:not(.secondary)').click();
        await expect(create.locator('.form-feedback')).toContainText(es ? 'Guardado' : 'Saved');
        const created = await page.evaluate(() => window.calendarCalls.at(-1));
        expect(created.start).toMatch(/^2026-11-30T20:00(:00)?$/);
        expect(created).toMatchObject({
          homeId: 'demo',
          operation: 'activity',
          id: '5a6c7d1e-1111-4111-8111-111111111111',
          version: '0',
          timezone: 'Europe/Madrid',
          title: 'Cena de prueba',
          location_kind: 'home',
          participants: 'u2',
          end: '',
        });
        // Reservation creation starts on the selected day with active resources only.
        const reserve = page.locator('#create-reservation');
        await reserve.locator(':scope > summary').click();
        await expect(reserve.locator('input[name="start"]')).toHaveValue(
          /^2026-11-28T18:00(:00)?$/,
        );
        await expect(reserve.locator('input[name="end"]')).toHaveValue(/^2026-11-28T19:00(:00)?$/);
        await expect(reserve.locator('select[name="resource"] option')).toHaveText([
          'Lavadora',
          'Baño',
        ]);
        for (const form of [create, reserve]) {
          const fits = await form.evaluate((panel) => {
            const bounds = panel.getBoundingClientRect();
            return [...panel.querySelectorAll('input:not([type="hidden"]), select, textarea')]
              .filter((field) => field.getClientRects().length > 0)
              .every((field) => {
                const rect = field.getBoundingClientRect();
                return rect.left >= bounds.left && rect.right <= bounds.right;
              });
          });
          expect(fits).toBe(true);
        }
        // Resource filter narrows the reservations of the selected day.
        await day(26).click();
        await page.locator('.calendar-filter-panel > summary').click();
        await page.locator('.calendar-filters select').selectOption(ids.bath);
        await expect(page.locator(`#reservation-${ids.laundry}`)).toHaveCount(0);
        await expect(page.locator(`#reservation-${ids.shower}`)).toBeVisible();
        await expect(card).toBeVisible();
        expect(new URL(page.url()).searchParams.get('resource')).toBe(ids.bath);
        await expect(reserve.locator('select[name="resource"]')).toHaveValue(ids.bath);
        // A resource the person picks in the form is not overridden by later filters.
        const washer = '1c6c7d1e-1111-4111-8111-111111111111';
        await reserve.locator('select[name="resource"]').selectOption(washer);
        await page.locator('.calendar-filters select').selectOption('');
        await page.locator('.calendar-filters select').selectOption(ids.bath);
        await expect(reserve.locator('select[name="resource"]')).toHaveValue(washer);
        await page.locator('.calendar-filter-panel > summary').click();
        // Participation and cancellation reuse the calendar action in place; the saved
        // answer is visibly distinct, not only announced through aria-pressed.
        await expect(card.locator('button[name="response"][aria-pressed="true"]')).toHaveText(
          es ? 'Voy' : 'Going',
        );
        const answers = await card
          .locator('button[name="response"]')
          .evaluateAll((buttons) => buttons.map((b) => getComputedStyle(b).backgroundColor));
        expect(answers[0]).not.toBe(answers[1]);
        expect(answers[1]).toBe(answers[2]);
        await card.locator('button[name="response"][value="maybe"]').click();
        await expect
          .poll(() => page.evaluate(() => window.calendarCalls.at(-1).operation))
          .toBe('attend');
        expect(await page.evaluate(() => window.calendarCalls.at(-1))).toMatchObject({
          id: ids.activity,
          response: 'maybe',
        });
        const cancel = card.locator(':scope > article > details').nth(1);
        await cancel.locator(':scope > summary').click();
        await cancel.locator('input[name="confirm"]').check();
        await cancel.locator('form > button.button:not(.secondary)').click();
        await expect
          .poll(() => page.evaluate(() => window.calendarCalls.at(-1).operation))
          .toBe('cancel_activity');
        expect(await page.evaluate(() => window.calendarCalls.at(-1))).toMatchObject({
          id: ids.activity,
          version: '3',
          confirm: 'on',
        });
        const edit = card.locator(':scope > article > details').nth(0);
        await edit.locator(':scope > summary').click();
        await expect(edit.locator('input[name="start"]')).toHaveValue(/^2026-11-26T20:00(:00)?$/);
        await expect(edit.getByLabel('Bea', { exact: true })).toBeDisabled();
        // Past days are for consultation only.
        await day(20).click();
        await expect(
          page.getByText(es ? 'Este día ya ha pasado' : 'This day has passed'),
        ).toBeVisible();
        await expect(page.locator('#create-activity')).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        expect(errors).toEqual([]);
        await page.close();
        scenarios++;
      }
  // A deep link with ?create opens the requested panel on the selected day.
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${origin}/?month=2026-11&day=2026-11-26&create=reservation`);
    await expect(page.locator('#create-reservation')).toHaveAttribute('open', '');
    await expect(page.locator('#create-activity')).not.toHaveAttribute('open', '');
    await page.close();
    scenarios++;
  }
  console.log(`${scenarios} calendar browser scenarios passed.`);
} finally {
  await browser?.close();
  server.close();
  await rm(temp, { recursive: true, force: true });
}
