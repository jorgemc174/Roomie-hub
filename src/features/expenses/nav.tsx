import Link from 'next/link';
import { History } from 'lucide-react';
import { SectionTabs } from '@/components/section-tabs';
import type { Locale } from '@/lib/i18n/dictionaries';
import { expenseMessages } from './messages';

export function ExpensesNav({
  homeId,
  locale,
  tab,
}: {
  homeId: string;
  locale: Locale;
  tab: string;
}) {
  const t = expenseMessages(locale),
    base = `/homes/${homeId}/expenses`;
  return (
    <div className="section-navigation">
      <SectionTabs
        label={t.title}
        items={[
          ['expenses', t.movements],
          ['balances', t.balances],
          ['recurring', t.recurring],
        ].map(([key, label]) => ({ href: `${base}?tab=${key}`, label, current: tab === key }))}
      />
      <Link
        className="section-settings text-link"
        href={`${base}?tab=history`}
        aria-current={tab === 'history' ? 'page' : undefined}
      >
        <History size={16} aria-hidden="true" />
        {t.changeHistory}
      </Link>
    </div>
  );
}
