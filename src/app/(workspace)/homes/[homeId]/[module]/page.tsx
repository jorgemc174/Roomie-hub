import { notFound } from 'next/navigation';
import Link from 'next/link';
import { CalendarDays, ListTodo, Wallet, Heart, MessageCircle } from 'lucide-react';
import { getHome } from '@/lib/data';
import { i18n } from '@/lib/i18n/server';
import { futureModules, type FutureModule } from '@/features/contracts';
const icons = {
  calendar: CalendarDays,
  organization: ListTodo,
  expenses: Wallet,
  community: Heart,
  chat: MessageCircle,
};
export default async function Module({
  params,
}: {
  params: Promise<{ homeId: string; module: string }>;
}) {
  const { homeId, module } = await params;
  await getHome(homeId);
  if (!futureModules.includes(module as FutureModule)) notFound();
  const key = module as FutureModule;
  const Icon = icons[key];
  const { t } = await i18n();
  return (
    <section className="future-panel panel">
      <div className="module-icon">
        <Icon size={30} />
      </div>
      <span className="badge">{t.future}</span>
      <h1>{t[key]}</h1>
      <p>{t.futureBody}</p>
      <Link className="button secondary" href={`/homes/${homeId}`}>
        {t.back}
      </Link>
    </section>
  );
}
