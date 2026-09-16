import Link from 'next/link';
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
    <section className="panel">
      <h2>{t.balance}</h2>
      <p>{BigInt(balance) === 0n ? t.zero : formatMoney(balance, home.currency, locale)}</p>
      <Link className="text-link" href={`/homes/${homeId}/expenses?tab=balances`}>
        {t.balances}
      </Link>
    </section>
  );
}
