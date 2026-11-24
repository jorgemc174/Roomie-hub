import Link from 'next/link';
import type { ReactNode } from 'react';
import { SectionTabs } from '@/components/section-tabs';
import { OptionsMenu } from '@/components/ui/options-menu';
import type { Locale } from '@/lib/i18n/dictionaries';
import { communityMessages } from './messages';
import { organizationMessages } from '@/features/organization/messages';

export function communityTab(value: string | string[] | undefined) {
  return value === 'punishments' || value === 'reasons' ? value : 'points';
}

export function CommunityNav({
  homeId,
  locale,
  tab,
}: {
  homeId: string;
  locale: Locale;
  tab: string;
}) {
  const t = communityMessages(locale);
  return (
    <div className="section-navigation">
      <SectionTabs
        label={t.title}
        items={[
          ['points', t.pointsAndRanking],
          ['tasks', organizationMessages(locale).tasks],
          ['punishments', t.punishments],
        ].map(([key, label]) => ({
          href: `/homes/${homeId}/community?tab=${key}`,
          label,
          current: tab === key || (tab === 'absences' && key === 'tasks'),
        }))}
      />
    </div>
  );
}

export function CommunityOptions({
  homeId,
  locale,
  tab,
  children,
}: {
  homeId: string;
  locale: Locale;
  tab: string;
  children?: ReactNode;
}) {
  const t = communityMessages(locale);
  return (
    <OptionsMenu label={`${t.title}: ${t.options}`}>
      <Link
        href={`/homes/${homeId}/community?tab=reasons`}
        aria-current={tab === 'reasons' ? 'page' : undefined}
      >
        {t.configureReasons}
      </Link>
      {children}
    </OptionsMenu>
  );
}
