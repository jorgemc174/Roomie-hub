import Link from 'next/link';
import type { ReactNode } from 'react';
import { Settings2, ArrowLeft } from 'lucide-react';
import { ViewFilter } from '@/components/view-filter';
import type { Locale } from '@/lib/i18n/dictionaries';
import { organizationMessages } from './messages';

export function TaskNavigation({
  homeId,
  locale,
  view,
  from,
  returnView = 'mine',
  children,
}: {
  homeId: string;
  locale: Locale;
  view: string;
  from: string;
  returnView?: string;
  children: ReactNode;
}) {
  const t = organizationMessages(locale),
    base = `/homes/${homeId}/organization`,
    previous = returnView === 'all' || returnView === 'cancelled' ? returnView : 'mine';
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
          <>
            <ViewFilter
              label={t.tasks}
              value={`${base}?view=${view}&from=${from}`}
              options={(['mine', 'all', 'cancelled'] as const).map((key) => ({
                href: `${base}?view=${key}&from=${from}`,
                label: t[key],
              }))}
            />
            <Link
              className="text-link section-settings"
              href={`${base}?view=manage&from=${from}&returnView=${view === 'all' || view === 'cancelled' ? view : 'mine'}`}
            >
              <Settings2 size={16} aria-hidden="true" />
              {t.manage}
            </Link>
          </>
        )}
      </div>
      {children}
    </div>
  );
}
