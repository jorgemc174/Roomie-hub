import Link from 'next/link';
import type { Locale } from '@/lib/i18n/dictionaries';
import { communityMessages } from './messages';
import { rankMembers, type CommunityBalance } from './models';

export function CommunityRanking({
  homeId,
  locale,
  balances,
  currentUserId,
  avatars,
}: {
  homeId: string;
  locale: Locale;
  balances: CommunityBalance[];
  currentUserId: string;
  avatars: Record<string, string | null>;
}) {
  const t = communityMessages(locale),
    number = (value: number) => new Intl.NumberFormat(locale).format(Number(value));
  return (
    <section className="stack">
      <p className="community-ranking-rule" id="ranking-order">
        {t.rankingOrder}
      </p>
      <table className="community-ranking" aria-describedby="ranking-order">
        <caption className="sr-only">{t.ranking}</caption>
        <colgroup>
          <col className="ranking-position" />
          <col className="ranking-person" />
          <col className="ranking-points" />
          <col className="ranking-points" />
          <col className="ranking-pending" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">
              <span aria-hidden="true">#</span>
              <span className="sr-only">{t.position}</span>
            </th>
            <th scope="col">{t.person}</th>
            <th scope="col" title={t.rankingPositivesHelp}>
              {t.positives}
              <span className="sr-only"> · {t.rankingPositivesHelp}</span>
            </th>
            <th scope="col" title={t.effective}>
              {t.negatives}
              <span className="sr-only"> · {t.effective}</span>
            </th>
            <th scope="col" title={`${t.punishments} · ${t.pending}`}>
              {t.rankingPunishments}
              <span className="sr-only"> · {t.pending}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rankMembers(balances).map((balance, index) => (
            <tr
              key={balance.user_id}
              className={balance.user_id === currentUserId ? 'is-current' : undefined}
            >
              <td>{number(index + 1)}</td>
              <th scope="row">
                <Link
                  className="ranking-member"
                  href={`/homes/${homeId}/community?tab=points&person=${balance.user_id}`}
                >
                  {avatars[balance.user_id] ? (
                    <img className="avatar" src={avatars[balance.user_id]!} alt="" />
                  ) : (
                    <span className="ranking-avatar" aria-hidden="true">
                      {balance.user_name.slice(0, 1)}
                    </span>
                  )}
                  <span className="ranking-name" title={balance.user_name}>
                    {balance.user_name}
                  </span>
                  {balance.user_id === currentUserId && <span className="sr-only"> · {t.you}</span>}
                </Link>
              </th>
              <td title={t.rankingPositivesHelp}>
                {number(balance.positive_available)}{' '}
                <span className="ranking-history">({number(balance.positive_history)})</span>
              </td>
              <td>{number(balance.negative_effective)}</td>
              <td>{balance.pending_punishments > 0 ? number(balance.pending_punishments) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
