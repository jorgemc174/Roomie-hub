import Link from 'next/link';
import type { ReactNode } from 'react';
import { OptionsMenu } from '@/components/ui/options-menu';
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
    </div>
  );
}

export function ExpensesOptions({
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
  const t = expenseMessages(locale);
  return (
    <OptionsMenu label={`${t.title}: ${t.options}`}>
      <Link
        href={`/homes/${homeId}/expenses?tab=history`}
        aria-current={tab === 'history' ? 'page' : undefined}
      >
        {t.changeHistory}
      </Link>
      {children}
    </OptionsMenu>
  );
}
