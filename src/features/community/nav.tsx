import Link from 'next/link';
import { Settings2 } from 'lucide-react';
import { SectionTabs } from '@/components/section-tabs';
import type { Locale } from '@/lib/i18n/dictionaries';
import { communityMessages } from './messages';
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
        items={(['points', 'punishments', 'ranking', 'activities'] as const).map((key) => ({
          href:
            key === 'activities'
              ? `/homes/${homeId}/community/activities`
              : `/homes/${homeId}/community?tab=${key}`,
          label: t[key],
          current: tab === key,
        }))}
      />
      <Link
        className="section-settings text-link"
        href={`/homes/${homeId}/community?tab=reasons`}
        aria-current={tab === 'reasons' ? 'page' : undefined}
      >
        <Settings2 size={16} aria-hidden="true" />
        {t.configureReasons}
      </Link>
    </div>
  );
}
