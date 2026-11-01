import { CreatePanel } from '@/components/ui/create-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { CommunityNav, CommunityOptions } from '@/features/community/nav';
import Link from 'next/link';
import { getHome, requireUser } from '@/lib/data';
import { i18n } from '@/lib/i18n/server';
import { homeDate } from '@/lib/timezones';
import { addDays } from '@/features/organization/logic';
import {
  readActivityPage,
  readActivityMembers,
  calendarPageIndex,
  calendarPageHref,
  calendarItem,
} from './queries';
import { calendarMessages } from './messages';
import { CalendarForm } from './form';
import { localInput, formatInstant } from './logic';
import type { Activity } from './models';
export async function ActivitiesPage({
  homeId,
  search,
}: {
  homeId: string;
  search: Record<string, string | string[] | undefined>;
}) {
  const home = await getHome(homeId),
    { db, user } = await requireUser(),
    { locale, t: ui } = await i18n(),
    t = calendarMessages(locale),
    tomorrow = addDays(homeDate(home.timezone), 1),
    base = `/homes/${homeId}/community/activities`,
    now = new Date().toISOString();
  const check = await db.from('activities').select('id').eq('home_id', homeId).limit(1);
  if (check.error)
    return (
      <p className="notice error" role="alert">
        {check.error.code === '42P01' || check.error.code === 'PGRST205' ? t.migration : t.error}
      </p>
    );
  const view = typeof search.view === 'string' ? search.view : 'upcoming',
    item = calendarItem(search.item),
    page = item ? 0 : calendarPageIndex(search.page);
  const { rows: shown, hasMore } = await readActivityPage(db, homeId, { view, now, page, item });
  const members = await readActivityMembers(
    db,
    homeId,
    shown.map((a) => a.id),
  );
  const fields = (a?: Activity) => (
    <>
      <label>
        {t.title}
        <input name="title" required maxLength={160} defaultValue={a?.title ?? ''} />
      </label>
      <label>
        {t.description}
        <textarea name="description" maxLength={4000} defaultValue={a?.description ?? ''} />
      </label>
      <label>
        {t.location}
        <input name="location" maxLength={300} defaultValue={a?.location ?? ''} />
      </label>
      <label>
        {t.start}
        <input
          name="start"
          type="datetime-local"
          step={1}
          required
          defaultValue={a ? localInput(a.starts_at, home.timezone) : `${tomorrow}T21:00:00`}
        />
      </label>
      <label>
        {t.optionalEnd}
        <input
          name="end"
          type="datetime-local"
          step={1}
          defaultValue={a?.ends_at ? localInput(a.ends_at, home.timezone) : ''}
        />
      </label>
      <details className="ui-help">
        <summary>
          {t.timezone}: {home.timezone}
        </summary>
        <p>{t.timeHelp}</p>
      </details>
    </>
  );
  return (
    <div className="organization">
      <PageHeader
        title={t.activities}
        action={
          <CommunityOptions homeId={homeId} locale={locale} tab="activities">
            <Link href={base} aria-current={view === 'upcoming' ? 'page' : undefined}>
              {t.upcoming}
            </Link>
            <Link
              href={`${base}?view=history`}
              aria-current={view === 'history' ? 'page' : undefined}
            >
              {t.history}
            </Link>
            <Link href={`/homes/${homeId}/calendar`}>{t.calendar}</Link>
          </CommunityOptions>
        }
      />
      <CommunityNav homeId={homeId} locale={locale} tab="activities" />
      <CreatePanel
        title={t.newActivity}
        closeLabel={ui.closePanel}
        id="create-activity"
        defaultOpen={search.create === 'activity'}
      >
        <p>{t.creatorJoins}</p>
        <CalendarForm
          homeId={homeId}
          operation="activity"
          id={crypto.randomUUID()}
          timezone={home.timezone}
          locale={locale}
          label={t.save}
        >
          {fields()}
        </CalendarForm>
      </CreatePanel>
      <h2>{view === 'history' ? t.history : view === 'all' ? t.activities : t.upcoming}</h2>
      {!shown.length && <EmptyState title={t.noActivities} />}
      {shown.map((a) => {
        const participants = members.filter((m) => m.activity_id === a.id && m.attending),
          joined = participants.some((m) => m.user_id === user.id);
        return (
          <article className="panel" key={a.id} id={`activity-${a.id}`}>
            <h2>{a.title}</h2>
            <p>
              {formatInstant(a.starts_at, home.timezone, locale)}
              {a.ends_at ? ` → ${formatInstant(a.ends_at, home.timezone, locale)}` : ''}
            </p>
            <p>{a.location}</p>
            <p style={{ whiteSpace: 'pre-wrap' }}>{a.description}</p>
            <small>
              {t.creator}: {a.created_by_name}
            </small>
            <h3>{t.participants}</h3>
            {participants.length ? (
              <ul>
                {participants.map((m) => (
                  <li key={m.user_id}>{m.user_name}</li>
                ))}
              </ul>
            ) : (
              <p>{t.notAttending}</p>
            )}{' '}
            {a.cancelled_at ? (
              <p className="badge cancelled">{t.cancelled}</p>
            ) : (
              <>
                {Date.parse(a.ends_at ?? a.starts_at) > Date.parse(now) && (
                  <CalendarForm
                    homeId={homeId}
                    operation="attend"
                    id={a.id}
                    locale={locale}
                    label={joined ? t.leave : t.join}
                    key={`${a.id}-${joined}`}
                  >
                    <input type="hidden" name="joining" value={joined ? 'false' : 'true'} />
                  </CalendarForm>
                )}
                <details>
                  <summary>{t.edit}</summary>
                  <CalendarForm
                    homeId={homeId}
                    operation="activity"
                    id={a.id}
                    version={a.version}
                    timezone={home.timezone}
                    locale={locale}
                    label={t.save}
                  >
                    {fields(a)}
                  </CalendarForm>
                </details>
                <details>
                  <summary>{t.cancel}</summary>
                  <CalendarForm
                    homeId={homeId}
                    operation="cancel_activity"
                    id={a.id}
                    version={a.version}
                    locale={locale}
                    label={t.cancel}
                  >
                    <label className="checkbox">
                      <input name="confirm" type="checkbox" required />
                      {t.cancelConfirm}
                    </label>
                  </CalendarForm>
                </details>
              </>
            )}
          </article>
        );
      })}
      {(page > 0 || hasMore) && (
        <nav className="row wrap" aria-label={t.pages}>
          {page > 0 && (
            <Link className="button secondary" href={calendarPageHref(base, search, page - 1)}>
              {t.previousPage}
            </Link>
          )}
          {hasMore && (
            <Link className="button secondary" href={calendarPageHref(base, search, page + 1)}>
              {t.nextPage}
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
