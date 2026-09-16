import Link from 'next/link';
import { getHome, getMembers, requireUser } from '@/lib/data';
import { i18n } from '@/lib/i18n/server';
import { homeDate } from '@/lib/timezones';
import { validDate, addDays } from '@/features/organization/logic';
import { calendarRows } from './queries';
import { calendarMessages } from './messages';
import { CalendarForm } from './form';
import { localInput, formatInstant, eventOnDay } from './logic';
import type { Reservation } from './models';
export async function ReservationsPage({
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
    today = homeDate(home.timezone),
    tomorrow = addDays(today, 1),
    base = `/homes/${homeId}/organization/reservations`,
    now = new Date().toISOString();
  const r = await db.from('resources').select('id').eq('home_id', homeId).limit(1);
  if (r.error)
    return (
      <p className="notice error" role="alert">
        {r.error.code === '42P01' || r.error.code === 'PGRST205' ? t.migration : t.error}
      </p>
    );
  const [resources, reservations, members] = await Promise.all([
    calendarRows(db.from('resources').select('*').eq('home_id', homeId).order('name').order('id')),
    calendarRows(
      db.from('reservations').select('*').eq('home_id', homeId).order('starts_at').order('id'),
    ),
    getMembers(homeId),
  ]);
  const view = typeof search.view === 'string' ? search.view : 'upcoming',
    day = typeof search.day === 'string' && validDate(search.day) ? search.day : today,
    resource = typeof search.resource === 'string' ? search.resource : '';
  const onDay = (b: Reservation) =>
    eventOnDay(
      {
        id: b.id,
        sourceId: b.id,
        sourceType: 'reservations',
        title: b.title,
        startsAt: b.starts_at,
        endsAt: b.ends_at,
        allDay: false,
        status: 'scheduled',
        people: [],
        names: [],
        href: '',
      },
      day,
      home.timezone,
    );
  const shown = reservations.filter(
    (b) =>
      (!resource || b.resource_id === resource) &&
      (view === 'all' ||
        (view === 'history'
          ? !!b.cancelled_at || Date.parse(b.ends_at) <= Date.parse(now)
          : !b.cancelled_at &&
            (view === 'day' ? onDay(b) : Date.parse(b.ends_at) > Date.parse(now)))),
  );
  const fields = (b?: Reservation) => (
    <>
      <label>
        {t.resource}
        <select name="resource" required defaultValue={b?.resource_id ?? resource}>
          {resources
            .filter((x) => x.active || x.id === b?.resource_id)
            .map((x) => (
              <option key={x.id} value={x.id} disabled={!x.active}>
                {x.name}
                {x.active ? '' : ` · ${t.inactive}`}
              </option>
            ))}
        </select>
      </label>
      <label>
        {t.responsible}
        <select name="person" defaultValue={b?.responsible_id ?? user.id}>
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.profiles?.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t.title}
        <input name="title" maxLength={160} defaultValue={b?.title ?? ''} />
      </label>
      <label>
        {t.start}
        <input
          name="start"
          type="datetime-local"
          step={1}
          required
          defaultValue={b ? localInput(b.starts_at, home.timezone) : `${tomorrow}T18:00:00`}
        />
      </label>
      <label>
        {t.end}
        <input
          name="end"
          type="datetime-local"
          step={1}
          required
          defaultValue={b ? localInput(b.ends_at, home.timezone) : `${tomorrow}T19:00:00`}
        />
      </label>
    </>
  );
  return (
    <div className="organization">
      <header className="page-head">
        <div>
          <h1>{t.reservations}</h1>
          <p>
            {t.timezone}: <strong>{home.timezone}</strong>
          </p>
        </div>
      </header>
      <nav className="org-tabs">
        <Link href={`/homes/${homeId}/organization`}>{t.backOrganization}</Link>
        <Link href={base} aria-current="page">
          {t.reservations}
        </Link>
        <Link href={`/homes/${homeId}/calendar`}>{t.calendar}</Link>
      </nav>
      <p>{t.reservationHelp}</p>
      <p>{t.timeHelp}</p>
      <details className="panel" open={!resources.some((x) => x.active)}>
        <summary>{t.resources}</summary>
        <p>{t.resourceHelp}</p>
        <CalendarForm
          homeId={homeId}
          operation="initialize"
          id={crypto.randomUUID()}
          locale={locale}
          label={t.initialize}
        />
        <details>
          <summary>{t.newResource}</summary>
          <CalendarForm
            homeId={homeId}
            operation="resource"
            id={crypto.randomUUID()}
            locale={locale}
            label={t.save}
          >
            <label>
              {t.name}
              <input name="name" required maxLength={100} />
            </label>
            <label>
              {t.description}
              <textarea name="description" maxLength={2000} />
            </label>
            <label className="checkbox">
              <input name="active" type="checkbox" defaultChecked />
              {t.active}
            </label>
          </CalendarForm>
        </details>
        {resources.map((x) => (
          <details key={x.id}>
            <summary>
              {x.name} · {x.active ? t.active : t.inactive}
            </summary>
            <CalendarForm
              homeId={homeId}
              operation="resource"
              id={x.id}
              version={x.version}
              locale={locale}
              label={t.save}
            >
              <label>
                {t.name}
                <input name="name" required maxLength={100} defaultValue={x.name} />
              </label>
              <label>
                {t.description}
                <textarea name="description" maxLength={2000} defaultValue={x.description} />
              </label>
              <label className="checkbox">
                <input name="active" type="checkbox" defaultChecked={x.active} />
                {t.active}
              </label>
            </CalendarForm>
          </details>
        ))}
      </details>
      {resources.some((x) => x.active) ? (
        <details className="panel">
          <summary>{t.newReservation}</summary>
          <CalendarForm
            homeId={homeId}
            operation="reservation"
            id={crypto.randomUUID()}
            timezone={home.timezone}
            locale={locale}
            label={t.save}
          >
            {fields()}
          </CalendarForm>
        </details>
      ) : (
        <p className="notice">{t.noResources}</p>
      )}
      <section className="panel">
        <h2>{t.availability}</h2>
        <form className="form" method="get">
          <div className="form-row">
            <label>
              {t.filter}
              <select name="view" defaultValue={view}>
                <option value="upcoming">{t.upcoming}</option>
                <option value="day">{t.day}</option>
                <option value="history">{t.history}</option>
                <option value="all">
                  {t.history} + {t.upcoming}
                </option>
              </select>
            </label>
            <label>
              {t.day}
              <input name="day" type="date" defaultValue={day} />
            </label>
            <label>
              {t.resource}
              <select name="resource" defaultValue={resource}>
                <option value="">{t.allResources}</option>
                {resources.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button className="button">{t.filter}</button>
        </form>
      </section>
      {!shown.length && <p>{t.noReservations}</p>}
      {shown.map((b) => (
        <article className="panel" key={b.id} id={`reservation-${b.id}`}>
          <h2>
            {b.resource_name}
            {b.title ? ` · ${b.title}` : ''}
          </h2>
          <p>
            {formatInstant(b.starts_at, home.timezone, locale)} →{' '}
            {formatInstant(b.ends_at, home.timezone, locale)}
          </p>
          <p>{b.responsible_name}</p>
          {b.cancelled_at ? (
            <p className="badge">{t.cancelled}</p>
          ) : (
            <>
              {Date.parse(b.ends_at) > Date.parse(now) && (
                <details>
                  <summary>{t.edit}</summary>
                  <CalendarForm
                    homeId={homeId}
                    operation="reservation"
                    id={b.id}
                    version={b.version}
                    timezone={home.timezone}
                    locale={locale}
                    label={t.save}
                  >
                    {fields(b)}
                  </CalendarForm>
                </details>
              )}
              <details>
                <summary>{t.cancel}</summary>
                <CalendarForm
                  homeId={homeId}
                  operation="cancel_reservation"
                  id={b.id}
                  version={b.version}
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
      ))}
    </div>
  );
}
