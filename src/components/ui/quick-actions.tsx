import Link from 'next/link';
import { Wallet, ArrowUpRight } from 'lucide-react';
import type { Locale } from '@/lib/i18n/dictionaries';
import { expenseMessages } from '@/features/expenses/messages';
export function QuickActions({
  homeId,
  locale,
  label,
}: {
  homeId: string;
  locale: Locale;
  label: string;
}) {
  const expense = expenseMessages(locale);
  return (
    <nav className="ui-quick-actions" aria-label={label}>
      <Link href={`/homes/${homeId}/expenses?create=expense`}>
        <Wallet size={20} aria-hidden="true" />
        <span>{expense.newExpense}</span>
        <ArrowUpRight size={16} aria-hidden="true" />
      </Link>
    </nav>
  );
}
