import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { SectionDisclosure } from '@/components/section-disclosure';
import type { Locale } from '@/lib/i18n/dictionaries';
import { organizationMessages } from './messages';

export function TaskNavigation({
  homeId,
  locale,
  view,
  from,
  today = from,
  returnView = 'mine',
  children,
}: {
  homeId: string;
  locale: Locale;
  view: string;
  from: string;
  today?: string;
  returnView?: string;
  children: ReactNode;
}) {
  const t = organizationMessages(locale),
    base = `/homes/${homeId}/organization`,
    previous = returnView === 'all' || returnView === 'cancelled' ? returnView : 'mine',
    activeView = view === 'all' || view === 'cancelled' ? view : 'mine',
    filterSummary = [
      ...(activeView !== 'mine' ? [t[activeView]] : []),
      ...(from !== today
        ? [
            `${t.from} ${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${from}T00:00:00Z`))}`,
          ]
        : []),
    ].join(' · ');
  return (
    <div className="section-heading task-toolbar">
      <div className="task-view-controls">
        {view === 'manage' ? (
          <Link
            className="text-link section-settings"
            href={`${base}?view=${previous}&from=${from}`}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            {t.backToTasks}
          </Link>
        ) : (
          <SectionDisclosure
            title={filterSummary ? `${t.filters} · ${filterSummary}` : t.filters}
            kind="filters"
          >
            <form className="form" action={base} method="get">
              <label>
                {t.view}
                <select name="view" defaultValue={activeView}>
                  {(['mine', 'all', 'cancelled'] as const).map((key) => (
                    <option key={key} value={key}>
                      {t[key]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t.from}
                <input name="from" type="date" defaultValue={from} required />
              </label>
              <button className="button secondary" type="submit">
                {t.apply}
              </button>
            </form>
          </SectionDisclosure>
        )}
      </div>
      {children}
    </div>
  );
}
