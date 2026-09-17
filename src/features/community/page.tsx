import Link from 'next/link';
import { getHome, getMembers, requireUser, signedImage } from '@/lib/data';
import { i18n } from '@/lib/i18n/server';
import { calendarRows } from '@/features/calendar/queries';
import { formatInstant } from '@/features/calendar/logic';
import { communityMessages } from './messages';
import { CommunityForm, RatingFields } from './form';
import { CommunityNav } from './nav';
import { rankMembers, type AuthorLabel, type RatingReason, type CommunityBalance } from './models';

export async function CommunityPage({
  homeId,
  search,
}: {
  homeId: string;
  search: Record<string, string | string[] | undefined>;
}) {
  const home = await getHome(homeId),
    { db, user } = await requireUser(),
    { locale } = await i18n(),
    t = communityMessages(locale),
    base = `/homes/${homeId}/community`;
  const tab =
    typeof search.tab === 'string' &&
    ['points', 'punishments', 'ranking', 'reasons'].includes(search.tab)
      ? search.tab
      : 'points';
  // This module explicitly reconciles at most 500 elapsed days per request. Other views do not.
  const report = await db.rpc('reconcile_community', { target: homeId });
  if (report.error)
    return (
      <p className="notice error" role="alert">
        {['PGRST202', '42P01'].includes(report.error.code) ? t.migration : t.error}
      </p>
    );
  const [reasons, members, result, punishments, redemptions] = await Promise.all([
    calendarRows(
      db
        .from('rating_reasons')
        .select('*')
        .eq('home_id', homeId)
        .order('kind')
        .order('name')
        .order('id'),
    ),
    getMembers(homeId),
    db.rpc('community_balances', { target: homeId }),
    calendarRows(
      db
        .from('punishments')
        .select('*')
        .eq('home_id', homeId)
        .order('triggered_at', { ascending: false })
        .order('id'),
    ),
    calendarRows(
      db
        .from('rating_redemptions')
        .select('*')
        .eq('home_id', homeId)
        .is('revoked_at', null)
        .order('id'),
    ),
  ]);
  if (result.error)
    return (
      <p className="notice error" role="alert">
        {t.error}
      </p>
    );
  const balances = result.data,
    person =
      typeof search.person === 'string' && balances.some((x) => x.user_id === search.person)
        ? search.person
        : '',
    history = search.history === 'on';
  const current = balances.find((x) => x.user_id === (person || user.id));
  const page =
    typeof search.page === 'string' && /^\d{1,6}$/.test(search.page) ? Number(search.page) : 0;
  let query = db
    .from('ratings')
    .select('*')
    .eq('home_id', homeId)
    .order('effective_at', { ascending: false })
    .order('id')
    .range(page * 50, page * 50 + 49);
  if (person) query = query.eq('target_user_id', person);
  if (!history) query = query.is('deleted_at', null);
  const ratings = tab === 'points' ? await query : { data: [], error: null };
  if (ratings.error)
    return (
      <p role="alert" className="notice error">
        {t.error}
      </p>
    );
  const labels = ratings.data.length
    ? await db.rpc('rating_author_labels', { target: homeId, items: ratings.data.map((r) => r.id) })
    : { data: [] as AuthorLabel[], error: null };
  if (labels.error)
    return (
      <p role="alert" className="notice error">
        {t.error}
      </p>
    );
  const number = (n: number) => new Intl.NumberFormat(locale).format(Number(n));
  const state = (b: CommunityBalance) => (
    <dl className="community-stats">
      {(
        [
          ['available', b.positive_available],
          ['effective', b.negative_effective],
          ['consumed', b.positive_consumed],
          ['credits', b.credits],
          ['pending', b.pending_punishments],
        ] as const
      ).map(([key, value]) => (
        <div key={key}>
          <dt>{t[key]}</dt>
          <dd>{number(value)}</dd>
        </div>
      ))}
    </dl>
  );
  const reasonFields = (r?: RatingReason) => (
    <>
      <label>
        {t.name}
        <input name="name" required maxLength={120} defaultValue={r?.name ?? ''} />
      </label>
      <label>
        {t.kind}
        <select name="kind" defaultValue={r?.kind ?? 'positive'}>
          <option value="positive">{t.positive}</option>
          <option value="negative">{t.negative}</option>
        </select>
      </label>
      <label className="checkbox">
        <input type="checkbox" name="requires_text" defaultChecked={r?.requires_text ?? false} />
        {t.needsText}
      </label>
      <label className="checkbox">
        <input type="checkbox" name="active" defaultChecked={r?.active ?? true} />
        {t.active}
      </label>
    </>
  );
  const selectedPunishments = punishments.filter((p) => !person || p.user_id === person);
  const punishmentList = (done: boolean) => (
    <section className="stack">
      <h2>{done ? t.completed : t.pending}</h2>
      {selectedPunishments
        .filter((p) => Boolean(p.completed_at) === done)
        .map((p) => (
          <article className="panel" key={p.id} id={`punishment-${p.id}`}>
            <h3>
              {p.user_name} · {p.severity === 'heavy' ? t.heavy : t.light}
            </h3>
            <p>
              {t.threshold}: {number(p.threshold)}
            </p>
            <p>{formatInstant(p.triggered_at, home.timezone, locale)}</p>
            {p.completed_at && (
              <p>
                {t.completedBy}: {p.completed_by_name} ·{' '}
                {formatInstant(p.completed_at, home.timezone, locale)}
              </p>
            )}
            <CommunityForm
              homeId={homeId}
              operation="punishment"
              id={p.id}
              version={p.version}
              locale={locale}
              label={t.save}
            >
              <label>
                {t.description}
                <textarea name="description" maxLength={2000} defaultValue={p.description} />
              </label>
              {!p.completed_at && (
                <>
                  <label className="checkbox">
                    <input name="finish" type="checkbox" />
                    {t.finish}
                  </label>
                  <small>{t.define}</small>
                </>
              )}
            </CommunityForm>
          </article>
        ))}
    </section>
  );
  return (
    <div className="organization">
      <header className="page-head">
        <h1>{t.title}</h1>
      </header>
      <CommunityNav homeId={homeId} locale={locale} tab={tab} />
      {report.data.more && <p className="notice">{t.more}</p>}
      <details className="panel">
        <summary>{t.reconcile}</summary>
        <CommunityForm
          homeId={homeId}
          operation="reconcile"
          id={crypto.randomUUID()}
          locale={locale}
          label={t.reconcile}
        />
      </details>
      {tab === 'reasons' && (
        <>
          <CommunityForm
            homeId={homeId}
            operation="initialize"
            id={crypto.randomUUID()}
            locale={locale}
            label={t.initialize}
          />
          <details className="panel">
            <summary>{t.newReason}</summary>
            <CommunityForm
              homeId={homeId}
              operation="reason"
              id={crypto.randomUUID()}
              locale={locale}
              label={t.save}
            >
              {reasonFields()}
            </CommunityForm>
          </details>
          {reasons.map((r) => (
            <details className="panel" key={r.id}>
              <summary>
                {t[r.kind]} · {r.name}
                {r.active ? '' : ' · ' + t.deleted}
              </summary>
              <CommunityForm
                homeId={homeId}
                operation="reason"
                id={r.id}
                version={r.version}
                locale={locale}
                label={t.save}
              >
                {reasonFields(r)}
              </CommunityForm>
            </details>
          ))}
        </>
      )}
      {tab === 'ranking' && (
        <section className="stack">
          <h2>{t.ranking}</h2>
          {await Promise.all(
            rankMembers(balances).map(async (b) => {
              const m = members.find((x) => x.user_id === b.user_id),
                avatar = await signedImage('avatars', m?.profiles?.avatar_path ?? null);
              return (
                <article className="panel" key={b.user_id}>
                  <Link href={`${base}?person=${b.user_id}`} className="member-row">
                    {avatar && <img className="avatar" src={avatar} alt="" />}
                    <h3>{b.user_name}</h3>
                  </Link>
                  <dl className="community-stats">
                    <div>
                      <dt>{t.effective}</dt>
                      <dd>{number(b.negative_effective)}</dd>
                    </div>
                    <div>
                      <dt>{t.available}</dt>
                      <dd>{number(b.positive_available)}</dd>
                    </div>
                    <div>
                      <dt>{t.pending}</dt>
                      <dd>{number(b.pending_punishments)}</dd>
                    </div>
                  </dl>
                </article>
              );
            }),
          )}
        </section>
      )}
      {(tab === 'points' || tab === 'punishments') && (
        <form method="get" className="form panel">
          <input type="hidden" name="tab" value={tab} />
          <label>
            {t.person}
            <select name="person" defaultValue={person}>
              <option value="">{t.all}</option>
              {balances.map((b) => (
                <option value={b.user_id} key={b.user_id}>
                  {b.user_name}
                  {b.active ? '' : ' · ' + t.former}
                </option>
              ))}
            </select>
          </label>
          {tab === 'points' && (
            <label className="checkbox">
              <input type="checkbox" name="history" defaultChecked={history} />
              {t.history}
            </label>
          )}
          <button className="button">{t.filter}</button>
        </form>
      )}
      {tab === 'punishments' && (
        <>
          {punishmentList(false)}
          {punishmentList(true)}
        </>
      )}
      {tab === 'points' && (
        <>
          {current && (
            <section className="panel">
              <h2>
                {current.user_name} · {t.memberState}
              </h2>
              {state(current)}
              <details>
                <summary>{t.historyHelp}</summary>
                <p>
                  {t.positiveHistory}: {number(current.positive_history)}
                </p>
                <p>
                  {t.negativeHistory}: {number(current.negative_history)}
                </p>
              </details>
              <Link href={`${base}?tab=punishments&person=${current.user_id}`}>
                {t.punishments}
              </Link>
            </section>
          )}
          <p>{t.conversionHelp}</p>
          <details className="panel">
            <summary>{t.rate}</summary>
            {!reasons.some((r) => r.active) ? (
              <Link href={`${base}?tab=reasons`}>{t.initialize}</Link>
            ) : (
              <CommunityForm
                homeId={homeId}
                operation="rating"
                id={crypto.randomUUID()}
                locale={locale}
                label={t.save}
              >
                <label>
                  {t.person}
                  <select
                    name="person"
                    required
                    defaultValue={person && person !== user.id ? person : ''}
                  >
                    <option value="" disabled>
                      {t.person}
                    </option>
                    {members
                      .filter((m) => m.user_id !== user.id)
                      .map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {m.profiles?.name}
                        </option>
                      ))}
                  </select>
                </label>
                <RatingFields reasons={reasons} locale={locale} />
              </CommunityForm>
            )}
          </details>
          {!ratings.data.length && <p>{t.empty}</p>}
          {ratings.data.map((r) => {
            const author = labels.data.find((a) => a.rating_id === r.id),
              used = redemptions.some((d) => d.positive_ids.includes(r.id)),
              compensated = redemptions.some((d) => d.negative_id === r.id);
            return (
              <article className="panel" key={r.id} id={`rating-${r.id}`}>
                <h2>
                  {r.target_name} · {t[r.kind]}
                </h2>
                <p>
                  {r.source === 'task_overdue'
                    ? `${t.automatic}: ${r.reason_name} · ${t.overdueDay} ${number(r.overdue_day ?? 0)}`
                    : r.reason_name}
                </p>
                <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.custom_text}</p>
                <p>{formatInstant(r.effective_at, home.timezone, locale)}</p>
                <p>
                  {t.author}:{' '}
                  {r.source !== 'manual' ? t.system : (author?.author_name ?? t.anonymousAuthor)}
                  {author?.is_mine ? ' · ' + t.own : ''}
                </p>
                {used && <p className="badge">{t.used}</p>}
                {compensated && <p className="badge">{t.compensated}</p>}
                {r.deleted_at ? (
                  <p className="badge">{t.deleted}</p>
                ) : (
                  <>
                    {r.attachment_path && (
                      <Link href={`${base}/photo/${r.id}`} target="_blank" rel="noopener">
                        {t.viewPhoto}
                      </Link>
                    )}
                    {r.source === 'manual' && (
                      <>
                        <details>
                          <summary>{t.edit}</summary>
                          <p>{t.recipientFixed}</p>
                          <CommunityForm
                            homeId={homeId}
                            operation="rating"
                            id={r.id}
                            version={r.version}
                            locale={locale}
                            label={t.save}
                          >
                            <input type="hidden" name="person" value={r.target_user_id} />
                            <RatingFields
                              reasons={reasons}
                              locale={locale}
                              rating={r}
                              mine={author?.is_mine}
                            />
                          </CommunityForm>
                        </details>
                        <details>
                          <summary>{t.photo}</summary>
                          <CommunityForm
                            homeId={homeId}
                            operation="photo"
                            id={r.id}
                            version={r.version}
                            locale={locale}
                            label={t.upload}
                          >
                            <label>
                              {t.photo}
                              <input
                                name="photo"
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                              />
                            </label>
                            <small>{t.photoHelp}</small>
                            {r.attachment_path && (
                              <label className="checkbox">
                                <input type="checkbox" name="remove_photo" />
                                {t.removePhoto}
                              </label>
                            )}
                          </CommunityForm>
                        </details>
                        <details>
                          <summary>{t.delete}</summary>
                          <CommunityForm
                            homeId={homeId}
                            operation="delete"
                            id={r.id}
                            version={r.version}
                            locale={locale}
                            label={t.delete}
                          >
                            <label className="checkbox">
                              <input name="confirm" type="checkbox" required />
                              {t.confirm}
                            </label>
                          </CommunityForm>
                        </details>
                      </>
                    )}
                  </>
                )}
              </article>
            );
          })}
          <nav className="org-tabs">
            {page > 0 && (
              <Link
                href={`${base}?person=${person}&history=${history ? 'on' : ''}&page=${page - 1}`}
              >
                {t.previous}
              </Link>
            )}
            {ratings.data.length === 50 && (
              <Link
                href={`${base}?person=${person}&history=${history ? 'on' : ''}&page=${page + 1}`}
              >
                {t.next}
              </Link>
            )}
          </nav>
        </>
      )}
    </div>
  );
}
