import { SectionTabs } from '@/components/section-tabs';
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
