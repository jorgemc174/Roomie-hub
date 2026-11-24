import { OptionsMenu } from '@/components/ui/options-menu';
import type { ReactNode } from 'react';
import Link from 'next/link';
import type { Locale } from '@/lib/i18n/dictionaries';
import { organizationMessages } from './messages';
import { communityMessages } from '@/features/community/messages';

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
    base = `/homes/${homeId}/community`;
  const query = new URLSearchParams({ tab: 'tasks', view: 'manage' });
  if (from) query.set('from', from);
  query.set('returnView', view === 'all' || view === 'cancelled' ? view : 'mine');
  return (
    <OptionsMenu label={`${communityMessages(locale).title}: ${t.options}`}>
      <Link href={`${base}?tab=absences`} aria-current={tab === 'absences' ? 'page' : undefined}>
        {t.absences}
      </Link>
      {tab === 'tasks' && view !== 'manage' && <Link href={`${base}?${query}`}>{t.manage}</Link>}
      {children}
    </OptionsMenu>
  );
}
