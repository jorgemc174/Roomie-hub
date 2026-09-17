import Link from 'next/link';
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
    <nav className="org-tabs">
      {(['points', 'punishments', 'ranking', 'activities', 'reasons'] as const).map((key) => (
        <Link
          key={key}
          href={
            key === 'activities'
              ? `/homes/${homeId}/community/activities`
              : `/homes/${homeId}/community?tab=${key}`
          }
          aria-current={tab === key ? 'page' : undefined}
        >
          {t[key]}
        </Link>
      ))}
    </nav>
  );
}
