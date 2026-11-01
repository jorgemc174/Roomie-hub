import { SectionTabs } from '@/components/section-tabs';
import { OptionsMenu } from '@/components/ui/options-menu';
import { PageHeader } from '@/components/ui/page-header';
import type { ReactNode } from 'react';
import Link from 'next/link';
import type { Locale } from '@/lib/i18n/dictionaries';
import { calendarMessages } from '@/features/calendar/messages';
import { organizationMessages } from './messages';

export function OrganizationNav({
  homeId,
  locale,
  tab,
}: {
  homeId: string;
  locale: Locale;
  tab: string;
}) {
  const t = organizationMessages(locale);
  const base = `/homes/${homeId}/organization`;
  return (
    <div className="section-navigation">
      <SectionTabs
        label={t.title}
        items={[
          { href: base, label: t.tasks, current: tab === 'tasks' },
          { href: `${base}?tab=shopping`, label: t.shopping, current: tab === 'shopping' },
          {
            href: `${base}/reservations`,
            label: calendarMessages(locale).reservations,
            current: tab === 'reservations',
          },
        ]}
      />
      {tab === 'absences' && (
        <Link className="text-link section-settings" href={base}>
          {t.backToTasks}
        </Link>
      )}
    </div>
  );
}

export function OrganizationOptions({
  homeId,
  locale,
  tab,
  view = 'mine',
  from,
  children,
}: {
  homeId: string;
  locale: Locale;
  tab: string;
  view?: string;
  from?: string;
  children?: ReactNode;
}) {
  const t = organizationMessages(locale),
    base = `/homes/${homeId}/organization`;
  const query = new URLSearchParams({ view: 'manage' });
  if (from) query.set('from', from);
  query.set('returnView', view === 'all' || view === 'cancelled' ? view : 'mine');
  return (
    <OptionsMenu label={`${t.title}: ${t.options}`}>
      <Link href={`${base}?tab=absences`} aria-current={tab === 'absences' ? 'page' : undefined}>
        {t.absences}
      </Link>
      {tab === 'tasks' && view !== 'manage' && <Link href={`${base}?${query}`}>{t.manage}</Link>}
      {children}
    </OptionsMenu>
  );
}

export function OrganizationLoadError({
  homeId,
  locale,
  tab,
  retryHref,
  message,
}: {
  homeId: string;
  locale: Locale;
  tab: string;
  retryHref: string;
  message: string;
}) {
  const t = organizationMessages(locale);
  return (
    <div className="organization">
      <PageHeader
        title={tab === 'absences' ? t.absences : t.title}
        action={<OrganizationOptions homeId={homeId} locale={locale} tab={tab} />}
      />
      <OrganizationNav homeId={homeId} locale={locale} tab={tab} />
      <section className="panel">
        <p className="notice error" role="alert">
          {message}
        </p>
        <Link className="button secondary" href={retryHref}>
          {t.retry}
        </Link>
      </section>
    </div>
  );
}
