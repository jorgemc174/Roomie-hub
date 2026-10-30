import { CalendarView } from '../../../src/features/calendar/calendar-view';
// Real UI components with a local router test boundary; no mocked Supabase data.
import { useMemo, useState } from 'react';
import { AccountLink, AccountReturn } from '../../../src/components/account-navigation';
import { OrganizationLoadError } from '../../../src/features/organization/nav';
import { MenusFixture } from './menus';
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
  const [path, setPath] = useState(
      location.pathname.startsWith('/homes/demo')
        ? location.pathname + location.search
        : '/homes/demo/organization',
    ),
    [saved, setSaved] = useState(0);
  const primary = new URLSearchParams(location.search).has('primary');
  const router = useMemo(() => ({ push: (href: string) => setPath(href) }), []);
  const current = new URL(path, 'http://fixture.local').searchParams.get('tab') || 'tasks';
  const fixtureMonth = new URLSearchParams(location.search).get('month') || '2026-10';
  if (location.pathname.startsWith('/homes/menus/')) return <MenusFixture />;
  if (
    /^\/(profile|notifications)(\/|$)/.test(location.pathname) ||
    location.pathname.includes('11111111-1111-4111-8111-111111111111')
  )
    return <AccountFixture />;
  if (new URLSearchParams(location.search).has('loadError'))
    return (
      <main id="main" className="page">
        <OrganizationLoadError
          homeId="demo"
          locale="es"
          tab="absences"
          retryHref={location.pathname + location.search}
          message="Isolated read error component"
        />
      </main>
    );
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

// Real contextual links and return component on native browser URLs. This is an
// isolated navigation boundary, not a fabricated profile, inbox or login session.
function AccountFixture() {
  const path = location.pathname;
  return (
    <RouterContext.Provider value={{ path, push: () => {} }}>
      <main id="main" className="page narrow">
        <h1>Account navigation component tests</h1>
        <nav className="actions" aria-label="Account links">
          <AccountLink href="/profile">Profile</AccountLink>
          <AccountLink href="/notifications">Notifications</AccountLink>
          <AccountLink href="/notifications/preferences">Preferences</AccountLink>
        </nav>
        {!path.startsWith('/homes/') && <AccountReturn label="Back to previous view" />}
        <p>Isolated navigation fixture; no account data.</p>
        <div id="task-example">Source anchor</div>
      </main>
    </RouterContext.Provider>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
