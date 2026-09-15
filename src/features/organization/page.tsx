import Link from 'next/link';
import { getHome, getMembers, requireUser } from '@/lib/data';
import { i18n } from '@/lib/i18n/server';
import { ActionForm } from '@/components/action-form';
import { organizationMessages } from './messages';
import { organizationAction } from './actions';
import { addDays, validDate, instanceStatus } from './logic';
import { ChoreForm } from './chore-form';

export async function OrganizationPage({
  homeId,
  search,
}: {
  homeId: string;
  search: Record<string, string | string[] | undefined>;
}) {
  await getHome(homeId);
  const { db, user } = await requireUser();
  const { locale } = await i18n();
  const t = organizationMessages(locale);
  const today = new Date().toISOString().slice(0, 10);
  const requested = typeof search.from === 'string' ? search.from : '';
  const from = validDate(requested) ? requested : today;
  const through = addDays(from, 30);
  const view = typeof search.view === 'string' ? search.view : 'mine';
  const tab = typeof search.tab === 'string' ? search.tab : 'tasks';
  const base = `/homes/${homeId}/organization`;
  const result = await db.rpc('generate_chore_instances', {
    target: homeId,
    from_date: from,
    through_date: through,
  });
  if (result.error)
    return (
      <section className="panel">
        <h1>{t.title}</h1>
        <p className="notice error" role="alert">
          {['PGRST202', '42P01'].includes(result.error.code) ? t.migration : t.loadError}
        </p>
        <Link className="button" href={base}>
          {t.retry}
        </Link>
      </section>
    );
  const [chores, rotations, instances, absences, lists, items, events, members] = await Promise.all(
    [
      db.from('chores').select('*').eq('home_id', homeId).order('created_at'),
      db.from('chore_rotation_members').select('*').eq('home_id', homeId).order('position'),
      db
        .from('chore_instances')
        .select('*')
        .eq('home_id', homeId)
      .or(`period_end.gt.${from},completed_at.is.null`)
        .lte('period_start', through)
        .order('period_start'),
      db
        .from('absences')
        .select('*')
        .eq('home_id', homeId)
        .is('deleted_at', null)
        .gte('end_date', from)
        .order('start_date'),
      db
        .from('shopping_lists')
        .select('*')
        .eq('home_id', homeId)
        .is('deleted_at', null)
        .order('created_at'),
      db
        .from('shopping_items')
        .select('*')
        .eq('home_id', homeId)
        .is('deleted_at', null)
        .order('created_at'),
      db.from('chore_assignment_events').select('*').eq('home_id', homeId).order('created_at'),
      getMembers(homeId),
    ],
  );
  if ([chores, rotations, instances, absences, lists, items, events].some((r) => r.error))
    return (
      <section className="panel">
        <p role="alert">{t.loadError}</p>
        <Link href={base}>{t.retry}</Link>
      </section>
    );
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
      timeZone: 'UTC',
    }).format(new Date(v)) + ' UTC';
  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;
  const taskRows = (instances.data ?? []).filter(
    (i) => view !== 'mine' || i.assignee_id === user.id,
  );
  return (
    <div className="organization">
      <header className="page-head">
        <div>
          <p className="eyebrow">{t.title}</p>
          <h1>{tab === 'shopping' ? t.shopping : tab === 'absences' ? t.absences : t.tasks}</h1>
          <p>{t.intro}</p>
        </div>
      </header>
      <nav className="org-tabs" aria-label={t.title}>
        {(['tasks', 'shopping', 'absences'] as const).map((k) => (
          <Link key={k} href={`${base}?tab=${k}`} aria-current={tab === k ? 'page' : undefined}>
            {t[k]}
          </Link>
        ))}
      </nav>
      {tab === 'tasks' && (
        <>
          {!!result.data?.blocked && (
            <p className="notice" role="status">
              {t.unavailable}
            </p>
          )}
          <div className="section-heading">
            <nav className="org-tabs" aria-label={t.tasks}>
              {(['mine', 'all', 'manage'] as const).map((k) => (
                <Link
                  key={k}
                  href={`${base}?view=${k}&from=${from}`}
                  aria-current={view === k ? 'page' : undefined}
                >
                  {t[k]}
                </Link>
              ))}
            </nav>
            <details className="org-disclosure">
              <summary className="button secondary">{t.newTask}</summary>
              <div className="panel">
                <ChoreForm homeId={homeId} rotations={[]} members={members} t={t} today={today} />
              </div>
            </details>
          </div>
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
              {taskRows.length === 0 && <p className="panel">{t.empty}</p>}
              <div className="task-list">
                {taskRows.map((i) => {
                  const status = instanceStatus(
                    i.deadline_at,
                    i.completed_at,
                    new Date().toISOString(),
                  );
                  return (
                    <article className={`task-row ${status}`} key={i.id}>
                      <div className="task-content">
                        <div className="section-heading">
                          <h2>{i.task_name}</h2>
                          <span className={`badge ${status}`}>{t[status]}</span>
                        </div>
                        <p>
                          {date(i.period_start)} – {date(addDays(i.period_end, -1))}
                        </p>
                        <p>
                          {t.assigned}: <strong>{i.assignee_name}</strong> · {t.difficulty}:{' '}
                          {i.difficulty}/5
                        </p>
                        {i.deadline_at && (
                          <p>
                            {t.deadline}: {stamp(i.deadline_at)}
                          </p>
                        )}
                        {i.assignment_blocked && <p className="notice error">{t.blocked}</p>}
                        {i.completed_at ? (
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
                          <summary>{t.history}</summary>
                          <ul>
                            {(events.data ?? [])
                              .filter((e) => e.instance_id === i.id)
                              .map((e) => (
                                <li key={e.id}>
                                  {e.reason === 'generated'
                                    ? t.generatedReason
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
          <details className="panel">
            <summary>{t.generate}</summary>
            <p>{t.generationHelp}</p>
            <ActionForm action={action('generate')} label={t.generate} pendingLabel={t.saving}>
              <div className="form-row">
                <label>
                  {t.from}
                  <input name="from" type="date" defaultValue={from} required />
                </label>
                <label>
                  {t.through}
                  <input name="through" type="date" defaultValue={through} required />
                </label>
              </div>
            </ActionForm>
          </details>
          <p>
            <small>{t.utcDates}</small>
          </p>
        </>
      )}
      {tab === 'absences' && (
        <>
          <p>{t.absenceHelp}</p>
          <details className="panel">
            <summary>{t.absent}</summary>
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
          </details>
          {!absences.data?.length && <p className="panel">{t.empty}</p>}
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
          <details className="panel">
            <summary>{t.newList}</summary>
            <ActionForm action={action('create_list')} label={t.newList} pendingLabel={t.saving}>
              <label>
                {t.name}
                <input name="name" required maxLength={100} />
              </label>
            </ActionForm>
          </details>
          {!lists.data?.length && <p className="panel">{t.empty}</p>}
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
