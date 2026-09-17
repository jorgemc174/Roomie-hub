import Link from 'next/link';
import { requireUser } from '@/lib/data';
import { i18n } from '@/lib/i18n/server';
import { communityMessages } from './messages';
export async function CommunitySummary({ homeId }: { homeId: string }) {
  const { db, user } = await requireUser(),
    { locale } = await i18n(),
    t = communityMessages(locale);
  const { data, error } = await db.rpc('community_balances', { target: homeId });
  if (error) return <p className="notice">{error.code === 'PGRST202' ? t.migration : t.error}</p>;
  const b = data.find((x) => x.user_id === user.id);
  if (!b) return null;
  const n = (value: number) => new Intl.NumberFormat(locale).format(Number(value));
  return (
    <section className="panel">
      <h2>{t.mySummary}</h2>
      <p>
        {t.available}: {n(b.positive_available)} · {t.effective}: {n(b.negative_effective)}
      </p>
      {Number(b.pending_punishments) > 0 && (
        <p>
          {t.punishments} · {t.pending}: {n(b.pending_punishments)}
        </p>
      )}
      <Link href={`/homes/${homeId}/community`}>{t.points}</Link>
    </section>
  );
}
