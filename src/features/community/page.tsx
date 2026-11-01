import { CreatePanel } from '@/components/ui/create-panel';
import { OptionsMenu } from '@/components/ui/options-menu';
import { PageHeader } from '@/components/ui/page-header';
import { SectionDisclosure } from '@/components/section-disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import Link from 'next/link';
import { getHome, getMembers, requireUser, signedImage } from '@/lib/data';
import { i18n } from '@/lib/i18n/server';
import { readCommunityRows } from './queries';
import { formatInstant } from '@/features/calendar/logic';
import { communityMessages } from './messages';
import { CommunityForm, RatingFields } from './form';
import { CommunityNav, CommunityOptions, communityTab } from './nav';
import { CommunityRanking } from './ranking';
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
    { locale, t: ui } = await i18n(),
    t = communityMessages(locale),
    base = `/homes/${homeId}/community`;
  const tab = communityTab(search.tab);
  // This module explicitly reconciles at most 500 elapsed days per request. Other views do not.
  const report = await db.rpc('reconcile_community', { target: homeId });
  if (report.error)
    return (
      <p className="notice error" role="alert">
        {['PGRST202', '42P01'].includes(report.error.code) ? t.migration : t.error}
      </p>
    );
  const [{ reasons, punishments, redemptions }, members, result] = await Promise.all([
    readCommunityRows(db, homeId, tab),
    getMembers(homeId),
    db.rpc('community_balances', { target: homeId }),
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
  const state = (b: CommunityBalance, secondary = false) => (
    <dl className="community-stats">
      {(
        [
          ['available', b.positive_available],
          ['effective', b.negative_effective],
          ['consumed', b.positive_consumed],
          ['credits', b.credits],
          ['pending', b.pending_punishments],
        ] as const
      )
        .filter((_, index) => (secondary ? index >= 2 : index < 2))
        .map(([key, value]) => (
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
  const rankingAvatars =
    tab === 'ranking'
      ? Object.fromEntries(
          await Promise.all(
            rankMembers(balances).map(async (balance) => {
              const member = members.find((m) => m.user_id === balance.user_id);
              return [
                balance.user_id,
                await signedImage('avatars', member?.profiles?.avatar_path ?? null),
              ];
            }),
          ),
        )
      : {};
  const filterSummary = [
    person ? balances.find((b) => b.user_id === person)?.user_name : t.all,
    ...(tab === 'points' && history ? [t.history] : []),
  ].join(' · ');
  const selectedPunishments = punishments.filter((p) => !person || p.user_id === person);
  const punishmentList = (done: boolean) => (
    <section className="stack">
      <h2>{done ? t.completed : t.pending}</h2>
      {selectedPunishments
        .filter((p) => Boolean(p.completed_at) === done)
        .map((p) => (
          <article className="panel" key={p.id} id={`punishment-${p.id}`}>
            <div className="section-heading options-heading">
              <h3>
                {p.user_name} ·{' '}
                <span className="badge punishment">
                  {p.severity === 'heavy' ? t.heavy : t.light}
                </span>{' '}
                · {number(p.threshold)}
              </h3>
              {!done && (
                <OptionsMenu label={`${p.user_name}: ${t.options}`}>
                  <details>
                    <summary>{t.edit}</summary>
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
                        <textarea
                          name="description"
                          maxLength={2000}
                          defaultValue={p.description}
                        />
                      </label>
                    </CommunityForm>
                  </details>
                </OptionsMenu>
              )}
            </div>
            <p className={`badge ${done ? 'completed' : 'pending'}`}>
              {done ? t.completed : t.pending}
            </p>
            {p.description && <p className="community-description">{p.description}</p>}
            <p>{formatInstant(p.triggered_at, home.timezone, locale)}</p>
            {p.completed_at && (
              <p>
                {t.completedBy}: {p.completed_by_name} ·{' '}
                {formatInstant(p.completed_at, home.timezone, locale)}
              </p>
            )}
            {!done &&
              (p.description.trim() ? (
                <CommunityForm
                  homeId={homeId}
                  operation="punishment"
                  id={p.id}
                  version={p.version}
                  locale={locale}
                  label={t.complete}
                >
                  <input type="hidden" name="description" value={p.description} />
                  <input type="hidden" name="finish" value="on" />
                </CommunityForm>
              ) : (
                <small>{t.define}</small>
              ))}
          </article>
        ))}
    </section>
  );
  return (
    <div className="organization">
      <PageHeader
        title={tab === 'reasons' ? t.configureReasons : t.title}
        action={<CommunityOptions homeId={homeId} locale={locale} tab={tab} />}
      />
      <CommunityNav homeId={homeId} locale={locale} tab={tab} />
      {tab === 'points' && (
        <CreatePanel
          title={t.rate}
          closeLabel={ui.closePanel}
          id="create-rating"
          defaultOpen={search.create === 'rating'}
        >
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
        </CreatePanel>
      )}
      {report.data.more && <p className="notice">{t.more}</p>}
      {(tab === 'reasons' || report.data.more) && (
        <SectionDisclosure title={t.reconcile} defaultOpen={report.data.more}>
          <CommunityForm
            homeId={homeId}
            operation="reconcile"
            id={crypto.randomUUID()}
            locale={locale}
            label={t.reconcile}
          />
        </SectionDisclosure>
      )}
      {tab === 'reasons' && (
        <>
          <h2>{t.reasons}</h2>
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
        <CommunityRanking
          homeId={homeId}
          locale={locale}
          balances={balances}
          currentUserId={user.id}
          avatars={rankingAvatars}
        />
      )}
      {(tab === 'points' || tab === 'punishments') && (
        <SectionDisclosure title={`${t.filters} · ${filterSummary}`} kind="filters">
          <form method="get" className="form">
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
        </SectionDisclosure>
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
              <h2>{current.user_name}</h2>
              <p className="muted">{t.memberState}</p>
              {state(current)}
              <details>
                <summary>{t.pointDetails}</summary>
                {state(current, true)}
                <p>{t.historyHelp}</p>
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
          <details className="ui-help">
            <summary>{t.pointRules}</summary>
            <p>{t.conversionHelp}</p>
          </details>
          {!ratings.data.length && <EmptyState title={t.empty} />}
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
                ) : r.source === 'manual' || r.attachment_path ? (
                  <OptionsMenu label={`${r.target_name}: ${t.options}`}>
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
                  </OptionsMenu>
                ) : null}
              </article>
            );
          })}
          <nav className="filter-links" aria-label={t.history}>
            {page > 0 && (
              <Link
                href={`${base}?tab=points&person=${person}&history=${history ? 'on' : ''}&page=${page - 1}`}
              >
                {t.previous}
              </Link>
            )}
            {ratings.data.length === 50 && (
              <Link
                href={`${base}?tab=points&person=${person}&history=${history ? 'on' : ''}&page=${page + 1}`}
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
