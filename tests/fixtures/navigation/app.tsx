import { CalendarView } from '../../../src/features/calendar/calendar-view';
// Real UI components with a local router test boundary; no mocked Supabase data.
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterContext } from './router';
import { SectionTabs } from '../../../src/components/section-tabs';
import { Navigation } from '../../../src/components/navigation';
import { SwipeNavigation } from '../../../src/components/swipe-navigation';
import { CreatePanel } from '../../../src/components/ui/create-panel';
import { es } from '../../../src/lib/i18n/dictionaries';
for (const method of ['pushState', 'replaceState'] as const) {
  const original = window.history[method].bind(window.history);
  window.history[method] = (data: unknown, unused: string, url?: string | URL | null) => {
    original(data, unused, url);
    window.dispatchEvent(new Event('fixture:history'));
  };
}
function App() {
  const [path, setPath] = useState('/homes/demo/organization'),
    [saved, setSaved] = useState(0);
  const primary = new URLSearchParams(location.search).has('primary');
  const router = useMemo(() => ({ push: (href: string) => setPath(href) }), []);
  const current = new URL(path, 'http://fixture.local').searchParams.get('tab') || 'tasks';
  const fixtureMonth = new URLSearchParams(location.search).get('month') || '2026-10';
  if (new URLSearchParams(location.search).has('calendar'))
    return (
      <main className="page" id="main">
        <CalendarView
          homeId="demo"
          month={fixtureMonth}
          selectedDay={fixtureMonth === '2026-10' ? '2026-10-29' : `${fixtureMonth}-01`}
          today="2026-10-29"
          timezone="Europe/Madrid"
          weekStart={1}
          locale="es"
          userId="demo"
          events={[]}
        />
      </main>
    );
  return (
    <RouterContext.Provider value={{ ...router, path }}>
      <div className="app-shell">
        <aside className="sidebar">
          <Navigation homeId="demo" t={es} />
        </aside>
        <main className="page organization" id="main">
          <h1>Navigation component tests</h1>
          {!primary && (
            <SectionTabs
              label="Organización"
              items={[
                { href: '/homes/demo/organization', label: 'Tareas', current: current === 'tasks' },
                {
                  href: '/homes/demo/organization?tab=shopping',
                  label: 'Compra',
                  current: current === 'shopping',
                },
                {
                  href: '/homes/demo/organization?tab=absences',
                  label: 'Ausencias',
                  current: current === 'absences',
                },
              ]}
            />
          )}
          <div
            data-testid="swipe-area"
            style={{ minHeight: 130, padding: 20, background: 'var(--mint)' }}
          >
            Swipe here
          </div>
          <output data-testid="route">{path}</output>
          <label>
            Protected input
            <input name="protected" />
          </label>
          <CreatePanel title="Create item" closeLabel="Close form">
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                setSaved((n) => n + 1);
              }}
            >
              <label>
                Draft
                <input name="draft" required />
              </label>
              <button className="button" type="submit">
                Save item
              </button>
            </form>
          </CreatePanel>
          <output data-testid="saved">{saved}</output>
        </main>
        <SwipeNavigation label="Loading…" />
      </div>
    </RouterContext.Provider>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
