import Link from 'next/link';
import { ListPlus, Wallet, ShoppingBasket, ArrowUpRight } from 'lucide-react';
import type { Locale } from '@/lib/i18n/dictionaries';
import { organizationMessages } from '@/features/organization/messages';
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
  const org = organizationMessages(locale),
    expense = expenseMessages(locale),
    base = `/homes/${homeId}`;
  return (
    <nav className="ui-quick-actions" aria-label={label}>
      {[
        { href: `${base}/organization?create=task`, label: org.newTask, Icon: ListPlus },
        { href: `${base}/expenses?create=expense`, label: expense.newExpense, Icon: Wallet },
        { href: `${base}/organization?tab=shopping`, label: org.shopping, Icon: ShoppingBasket },
      ].map(({ href, label, Icon }) => (
        <Link href={href} key={href}>
          <Icon size={20} aria-hidden="true" />
          <span>{label}</span>
          <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
      ))}
    </nav>
  );
}
