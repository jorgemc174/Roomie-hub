import Link from 'next/link';
import { getHome, requireUser } from '@/lib/data';
import { i18n } from '@/lib/i18n/server';
import { homeDate } from '@/lib/timezones';
import { addDays } from '@/features/organization/logic';
import { calendarRows } from './queries';
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
    { locale } = await i18n(),
    t = calendarMessages(locale),
    tomorrow = addDays(homeDate(home.timezone), 1),
    base = `/homes/${homeId}/community`,
    now = new Date().getTime();
  const check = await db.from('activities').select('id').eq('home_id', homeId).limit(1);
  if (check.error)
    return (
      <p className="notice error" role="alert">
        {check.error.code === '42P01' || check.error.code === 'PGRST205' ? t.migration : t.error}
      </p>
    );
  const [activities, members] = await Promise.all([
    calendarRows(
      db.from('activities').select('*').eq('home_id', homeId).order('starts_at').order('id'),
    ),
    calendarRows(
      db
        .from('activity_members')
        .select('*')
        .eq('home_id', homeId)
        .order('activity_id')
        .order('user_id'),
    ),
  ]);
  const view = typeof search.view === 'string' ? search.view : 'upcoming',
    shown = activities.filter(
      (a) =>
        view === 'all' ||
        (view === 'history'
          ? !!a.cancelled_at || Date.parse(a.ends_at ?? a.starts_at) <= now
          : !a.cancelled_at && Date.parse(a.ends_at ?? a.starts_at) > now),
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
    </>
  );
  return (
    <div className="organization">
      <header className="page-head">
        <div>
          <p className="eyebrow">{t.community}</p>
          <h1>{t.activities}</h1>
          <p>
            {t.timezone}: <strong>{home.timezone}</strong>
          </p>
        </div>
      </header>
      <p>{t.timeHelp}</p>
      <details className="panel">
        <summary>{t.newActivity}</summary>
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
      </details>
      <nav className="org-tabs">
        <Link href={base} aria-current={view === 'upcoming' ? 'page' : undefined}>
          {t.upcoming}
        </Link>
        <Link href={`${base}?view=history`} aria-current={view === 'history' ? 'page' : undefined}>
          {t.history}
        </Link>
        <Link href={`/homes/${homeId}/calendar`}>{t.calendar}</Link>
      </nav>
      {!shown.length && <p>{t.noActivities}</p>}
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
              <p className="badge">{t.cancelled}</p>
            ) : (
              <>
                {Date.parse(a.ends_at ?? a.starts_at) > now && (
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
    </div>
  );
}
