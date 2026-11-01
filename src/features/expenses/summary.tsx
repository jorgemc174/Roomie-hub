import Link from 'next/link';
import { Wallet } from 'lucide-react';
import { getHome, requireUser } from '@/lib/data';
import { i18n } from '@/lib/i18n/server';
import { expenseMessages } from './messages';
import { formatMoney } from './money';
export async function ExpenseSummary({ homeId }: { homeId: string }) {
  const { db, user } = await requireUser(),
    home = await getHome(homeId),
    { locale } = await i18n(),
    t = expenseMessages(locale);
  const { data, error } = await db.rpc('expense_balances', { target: homeId });
  if (error) return <p className="notice">{error.code === 'PGRST202' ? t.migration : t.error}</p>;
  const balance = data.find((b) => b.user_id === user.id)?.balance ?? '0';
  return (
    <section className="panel balance-panel">
      <h2 className="summary-heading">
        <span className="summary-icon" aria-hidden="true">
          <Wallet size={20} />
        </span>
        {t.balance}
      </h2>
      <p
        className={
          BigInt(balance) > 0n
            ? 'tone-positive'
            : BigInt(balance) < 0n
              ? 'tone-negative'
              : 'tone-money'
        }
      >
        {BigInt(balance) === 0n
          ? t.zero
          : `${BigInt(balance) > 0n ? t.owed : t.owe} ${formatMoney(BigInt(balance) < 0n ? -BigInt(balance) : balance, home.currency, locale)}`}
      </p>
      <div className="row wrap">
        <Link className="text-link" href={`/homes/${homeId}/expenses?tab=balances`}>
          {t.balances}
        </Link>
        <Link className="text-link" href={`/homes/${homeId}/expenses?create=expense`}>
          {t.newExpense}
        </Link>
      </div>
    </section>
  );
}
