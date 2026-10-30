import { SectionTabs } from '@/components/section-tabs';
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
        { href: `${base}?tab=absences`, label: t.absences, current: tab === 'absences' },
      ]}
    />
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
      <h1>{t.title}</h1>
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
