import { CreatePanel } from '@/components/ui/create-panel';
import { EmptyState } from '@/components/ui/empty-state';
import { OrganizationNav, OrganizationLoadError } from './nav';
import { TaskNavigation } from './task-navigation';
import { SectionDisclosure } from '@/components/section-disclosure';
import { expenseMessages } from '@/features/expenses/messages';
import Link from 'next/link';
import { getHome, getMembers, requireUser } from '@/lib/data';
import { i18n } from '@/lib/i18n/server';
import { ActionForm } from '@/components/action-form';
import { organizationMessages } from './messages';
import { organizationAction } from './actions';
import { addDays, validDate, instanceStatus } from './logic';
import { ChoreForm } from './chore-form';
import { readOrganizationRows } from './queries';
import { homeDate } from '@/lib/timezones';
import { ensureOrganizationPeriod } from './generation';

export async function OrganizationPage({
  homeId,
  search,
}: {
  homeId: string;
  search: Record<string, string | string[] | undefined>;
}) {
  const home = await getHome(homeId);
  const { db, user } = await requireUser();
  const { locale, t: ui } = await i18n();
  const t = organizationMessages(locale);
  const today = homeDate(home.timezone ?? 'UTC');
  const requested = typeof search.from === 'string' ? search.from : '';
  const from = validDate(requested) ? requested : today;
  const through = addDays(from, 30);
  const view = typeof search.view === 'string' ? search.view : 'mine';
  const tab = search.tab === 'shopping' || search.tab === 'absences' ? search.tab : 'tasks';
  const base = `/homes/${homeId}/organization`;
  const retrySearch = new URLSearchParams();
  for (const [key, value] of Object.entries(search))
    if (typeof value === 'string') retrySearch.set(key, value);
  const loadError = (message: string) => (
    <OrganizationLoadError
      homeId={homeId}
      locale={locale}
      tab={tab}
      retryHref={`${base}${retrySearch.size ? `?${retrySearch}` : ''}`}
      message={message}
    />
  );
  const result = await ensureOrganizationPeriod(db, homeId, tab);
  if (tab === 'tasks' && !result.error) {
    const penalties = await db.rpc('reconcile_community', { target: homeId });
    if (penalties.error) return loadError(t.error);
  }
  if (result.error)
    return loadError(['PGRST202', '42P01'].includes(result.error.code) ? t.migration : t.loadError);
  const [{ chores, rotations, instances, absences, lists, items, events }, members] =
    await Promise.all([readOrganizationRows(db, homeId, tab, from, through), getMembers(homeId)]);
  if ([chores, rotations, instances, absences, lists, items, events].some((r) => r.error))
    return loadError(t.loadError);
  const action = (op: string) => organizationAction.bind(null, homeId, op);
  const date = (v: string) =>
    new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(v));
  const stamp = (v: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: home.timezone ?? 'UTC',
    }).format(new Date(v)) + ` (${home.timezone ?? 'UTC'})`;
  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;
  const taskRows = (instances.data ?? []).filter(
    (i) =>
      (view === 'cancelled' ? !!i.cancelled_at : !i.cancelled_at) &&
      (view !== 'mine' || i.assignee_id === user.id),
  );
  return (
    <div className="organization">
      <header className="page-head">
        <div>
          <p className="eyebrow">{t.title}</p>
          <h1>
            {tab === 'shopping'
              ? t.shopping
              : tab === 'absences'
                ? t.absences
                : view === 'manage'
                  ? t.manage
                  : t.tasks}
          </h1>
          <p>{t.intro}</p>
        </div>
      </header>
      <OrganizationNav homeId={homeId} locale={locale} tab={tab} />
      {tab === 'tasks' && (
        <>
          {!!result.data?.blocked && (
            <p className="notice" role="status">
              {t.unavailable}
            </p>
          )}
          <TaskNavigation
            homeId={homeId}
            locale={locale}
            view={view}
            from={from}
            returnView={typeof search.returnView === 'string' ? search.returnView : undefined}
          >
            <CreatePanel
              title={t.newTask}
              closeLabel={ui.closePanel}
              id="create-task"
              defaultOpen={search.create === 'task'}
            >
              <div className="panel">
                <ChoreForm
                  homeId={homeId}
                  rotations={[]}
                  members={members}
                  t={t}
                  today={today}
                  homeTimezone={home.timezone}
                />
              </div>
            </CreatePanel>
          </TaskNavigation>
          {view === 'manage' ? (
            <>
              <details className="panel">
                <summary>{t.defaults}</summary>
                <p>{t.defaultsHelp}</p>
                <ActionForm
                  action={action('initialize')}
                  label={t.defaults}
                  pendingLabel={t.saving}
                />
              </details>
              {(chores.data ?? []).map((c) => (
                <details className="panel" key={c.id}>
                  <summary>
                    {c.name} · {c.active ? t.active : t.inactive}
                  </summary>
                  <ChoreForm
                    homeTimezone={home.timezone}
                    key={c.updated_at}
                    homeId={homeId}
                    chore={c}
                    rotations={rotations.data ?? []}
                    members={members}
                    t={t}
                    today={today}
                  />
                </details>
              ))}
            </>
          ) : (
            <>
              <form className="period-picker" action={base}>
                <input type="hidden" name="view" value={view} />
                <label>
                  {t.from}
                  <input name="from" type="date" defaultValue={from} required />
                </label>
                <button className="button secondary">{t.apply}</button>
              </form>
              {taskRows.length === 0 && (
                <EmptyState
                  title={
                    view === 'mine'
                      ? t.emptyMine
                      : view === 'cancelled'
                        ? t.emptyCancelled
                        : t.emptyTasks
                  }
                  action={
                    <Link className="button secondary" href={`${base}?create=task`}>
                      {t.newTask}
                    </Link>
                  }
                />
              )}
              <div className="task-list">
                {taskRows.map((i) => {
                  const status = i.cancelled_at
                    ? 'cancelled'
                    : instanceStatus(i.deadline_at, i.completed_at, new Date().toISOString());
                  return (
                    <article className={`task-row ${status}`} key={i.id} id={`task-${i.id}`}>
                      <div className="task-content">
                        <div className="section-heading">
                          <h2>{i.task_name}</h2>
                          <span className={`badge ${status}`}>{t[status]}</span>
                        </div>

                        <p>
                          {t.assigned}: <strong>{i.assignee_name}</strong>
                        </p>
                        {i.deadline_at && (
                          <p>
                            {t.deadline}: {stamp(i.deadline_at)}
                          </p>
                        )}
                        {i.assignment_blocked && <p className="notice error">{t.blocked}</p>}
                        {i.cancelled_at ? (
                          <p>
                            {t.cancelled} · {stamp(i.cancelled_at)}
                          </p>
                        ) : i.completed_at ? (
                          <p>
                            {t.completedBy}: {i.completed_by_name} · {stamp(i.completed_at)}
                          </p>
                        ) : (
                          <ActionForm
                            action={action('complete_chore')}
                            label={t.complete}
                            pendingLabel={t.saving}
                          >
                            {hidden('id', i.id)}
                          </ActionForm>
                        )}
                        <details>
                          <summary>{t.detailsHistory}</summary>
                          <p>
                            {date(i.period_start)} – {date(addDays(i.period_end, -1))} ·{' '}
                            {t.difficulty}: {i.difficulty}/5
                          </p>
                          <ul>
                            {(events.data ?? [])
                              .filter((e) => e.instance_id === i.id)
                              .map((e) => (
                                <li key={e.id}>
                                  {e.reason === 'generated'
                                    ? t.generatedReason
                                    : e.reason === 'blocked'
                                      ? t.blockedReason
                                      : e.reason === 'unblocked'
                                        ? t.unblockedReason
                                        : t.reassignedReason}
                                  : {e.assignee_name} · {stamp(e.created_at)}
                                </li>
                              ))}
                          </ul>
                        </details>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
          {(view === 'manage' || Boolean(result.data?.blocked)) && (
            <SectionDisclosure title={t.generate} defaultOpen={Boolean(result.data?.blocked)}>
              <p>{t.generationHelp}</p>
              <ActionForm action={action('generate')} label={t.generate} pendingLabel={t.saving}>
                <div className="form-row">
                  <label>
                    {t.from}
                    <input name="from" type="date" defaultValue={from} required />
                  </label>
                  <label>
                    {t.through}
                    <input name="through" type="date" defaultValue={addDays(today, 1)} required />
                  </label>
                </div>
              </ActionForm>
            </SectionDisclosure>
          )}
          <p>
            <small>
              {t.localDates} {home.timezone}
            </small>
          </p>
        </>
      )}
      {tab === 'absences' && (
        <>
          <p>{t.absenceHelp}</p>
          <CreatePanel
            title={t.absent}
            closeLabel={ui.closePanel}
            id="create-absence"
            defaultOpen={search.create === 'absence'}
          >
            <ActionForm action={action('save_absence')} label={t.save} pendingLabel={t.saving}>
              <label>
                {t.person}
                <select name="person" defaultValue={user.id}>
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.profiles?.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-row">
                <label>
                  {t.start}
                  <input type="date" name="start_date" defaultValue={today} required />
                </label>
                <label>
                  {t.end}
                  <input type="date" name="end_date" defaultValue={today} required />
                </label>
              </div>
            </ActionForm>
          </CreatePanel>
          {!absences.data?.length && (
            <EmptyState
              title={t.emptyAbsences}
              action={
                <Link className="button secondary" href={`${base}?tab=absences&create=absence`}>
                  {t.absent}
                </Link>
              }
            />
          )}
          {(absences.data ?? []).map((a) => (
            <article className="panel" key={a.id}>
              <h2>{a.user_name}</h2>
              <p>
                {date(a.start_date)} – {date(a.end_date)}
              </p>
              <details>
                <summary>{t.edit}</summary>
                <ActionForm action={action('save_absence')} label={t.save} pendingLabel={t.saving}>
                  {hidden('id', a.id)}
                  {hidden('person', a.user_id)}
                  <div className="form-row">
                    <label>
                      {t.start}
                      <input type="date" name="start_date" defaultValue={a.start_date} required />
                    </label>
                    <label>
                      {t.end}
                      <input type="date" name="end_date" defaultValue={a.end_date} required />
                    </label>
                  </div>
                </ActionForm>
              </details>
              <details>
                <summary>{t.delete}</summary>
                <ActionForm
                  action={action('delete_absence')}
                  label={t.confirmDelete}
                  pendingLabel={t.saving}
                  danger
                >
                  {hidden('id', a.id)}
                  {hidden('person', a.user_id)}
                  {hidden('start_date', a.start_date)}
                  {hidden('end_date', a.end_date)}
                </ActionForm>
              </details>
            </article>
          ))}
        </>
      )}
      {tab === 'shopping' && (
        <>
          <CreatePanel
            title={t.newList}
            closeLabel={ui.closePanel}
            id="create-list"
            defaultOpen={search.create === 'list'}
          >
            <ActionForm action={action('create_list')} label={t.newList} pendingLabel={t.saving}>
              <label>
                {t.name}
                <input name="name" required maxLength={100} />
              </label>
            </ActionForm>
          </CreatePanel>
          {!lists.data?.length && (
            <EmptyState
              title={t.emptyShopping}
              action={
                <Link className="button secondary" href={`${base}?tab=shopping&create=list`}>
                  {t.newList}
                </Link>
              }
            />
          )}
          {(lists.data ?? []).map((list) => {
            const products = (items.data ?? []).filter((i) => i.shopping_list_id === list.id);
            return (
              <section className="panel shopping-list" key={list.id}>
                <div className="section-heading">
                  <h2>{list.name}</h2>
                  <span className="badge">
                    {products.filter((i) => i.purchased).length}/{products.length}
                  </span>
                </div>
                {list.completed_at && (
                  <p className="notice success">
                    {t.purchased} · {stamp(list.completed_at)}
                  </p>
                )}
                {list.completed_at && (
                  <Link
                    className="button secondary"
                    href={`/homes/${homeId}/expenses?shopping=${list.id}`}
                  >
                    {expenseMessages(locale).shopping}
                  </Link>
                )}
                <ul className="products">
                  {products.map((item) => (
                    <li key={item.id} className={item.purchased ? 'purchased' : ''}>
                      <div>
                        <span>{item.name}</span>
                        {item.completed_at && (
                          <small>
                            {item.completed_by_name} · {stamp(item.completed_at)}
                          </small>
                        )}
                      </div>
                      <ActionForm
                        action={action('toggle_item')}
                        label={item.purchased ? t.unpurchase : t.buy}
                        pendingLabel={t.saving}
                      >
                        {hidden('list_id', list.id)}
                        {hidden('item_id', item.id)}
                        {hidden('checked', String(!item.purchased))}
                      </ActionForm>
                      <details>
                        <summary>{t.delete}</summary>
                        <ActionForm
                          action={action('delete_item')}
                          label={t.confirmDelete}
                          pendingLabel={t.saving}
                          danger
                        >
                          {hidden('list_id', list.id)}
                          {hidden('item_id', item.id)}
                        </ActionForm>
                      </details>
                    </li>
                  ))}
                </ul>
                <ActionForm action={action('add_item')} label={t.newItem} pendingLabel={t.saving}>
                  {hidden('list_id', list.id)}
                  <label>
                    {t.name}
                    <input name="name" required maxLength={100} />
                  </label>
                </ActionForm>
                {products.some((i) => !i.purchased) && (
                  <ActionForm
                    action={action('complete_list')}
                    label={t.completeList}
                    pendingLabel={t.saving}
                  >
                    {hidden('list_id', list.id)}
                  </ActionForm>
                )}
                <details>
                  <summary>{t.rename}</summary>
                  <ActionForm action={action('rename_list')} label={t.save} pendingLabel={t.saving}>
                    {hidden('list_id', list.id)}
                    <label>
                      {t.name}
                      <input name="name" required maxLength={100} defaultValue={list.name} />
                    </label>
                  </ActionForm>
                </details>
                <details>
                  <summary>{t.listDelete}</summary>
                  <ActionForm
                    action={action('delete_list')}
                    label={t.confirmDelete}
                    pendingLabel={t.saving}
                    danger
                  >
                    {hidden('list_id', list.id)}
                  </ActionForm>
                </details>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
