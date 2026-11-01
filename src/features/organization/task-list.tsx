import type { ActionState } from '@/app/actions';
import { ActionForm } from '@/components/action-form';
import { SectionDisclosure } from '@/components/section-disclosure';
import { OptionsMenu } from '@/components/ui/options-menu';
import type { Locale } from '@/lib/i18n/dictionaries';
import { instanceStatus } from './logic';
import { organizationMessages } from './messages';
import type { AssignmentEvent, ChoreInstance } from './models';
import { TaskAnchor } from './task-anchor';
import { splitTaskPeriods, TaskPeriodDates, TaskPeriodHeading } from './task-periods';

export function TaskList({
  rows,
  events,
  today,
  locale,
  completeAction,
  stamp,
}: {
  rows: ChoreInstance[];
  events: AssignmentEvent[];
  today: string;
  locale: Locale;
  completeAction: (state: ActionState, form: FormData) => Promise<ActionState>;
  stamp: (value: string) => string;
}) {
  const t = organizationMessages(locale);
  const { visible, backlog, backlogCount } = splitTaskPeriods(rows, today);
  const now = new Date().toISOString();
  const periods = (groups: typeof visible) =>
    groups.map((group) => (
      <section className="task-period" key={`${group.start}/${group.end}`}>
        <TaskPeriodHeading start={group.start} end={group.end} locale={locale} />
        {group.items.map((i) => {
          const status = i.cancelled_at
            ? 'cancelled'
            : instanceStatus(i.deadline_at, i.completed_at, now);
          return (
            <article className={`task-row ${status}`} key={i.id} id={`task-${i.id}`}>
              <div className="task-content">
                <div className="task-identity">
                  <h3>{i.task_name}</h3>
                  <p className="task-assignee">
                    <span className="sr-only">{t.assigned}: </span>
                    {i.assignee_name}
                  </p>
                  <p className="task-occurrence-date">
                    <TaskPeriodDates start={i.period_start} end={i.period_end} locale={locale} />
                  </p>
                  {status !== 'pending' && <span className={`badge ${status}`}>{t[status]}</span>}
                  {i.assignment_blocked && <p className="task-warning">{t.blocked}</p>}
                </div>
                {!i.cancelled_at && !i.completed_at && (
                  <ActionForm action={completeAction} label={t.done} pendingLabel={t.saving}>
                    <input type="hidden" name="id" value={i.id} />
                  </ActionForm>
                )}
                <OptionsMenu label={`${t.detailsHistory}: ${i.task_name}`}>
                  <h4>{t.detailsHistory}</h4>
                  <p>
                    <TaskPeriodDates start={i.period_start} end={i.period_end} locale={locale} />
                  </p>
                  <p>
                    {t.difficulty}: {i.difficulty}/5
                  </p>
                  {i.deadline_at && (
                    <p>
                      {t.deadline}: {stamp(i.deadline_at)}
                    </p>
                  )}
                  {i.cancelled_at ? (
                    <p>
                      {t.cancelled} · {stamp(i.cancelled_at)}
                    </p>
                  ) : i.completed_at ? (
                    <p>
                      {t.completedBy}: {i.completed_by_name} · {stamp(i.completed_at)}
                    </p>
                  ) : null}
                  <ul>
                    {events
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
                </OptionsMenu>
              </div>
            </article>
          );
        })}
      </section>
    ));
  return (
    <div className="task-list">
      <TaskAnchor instanceIds={rows.map((row) => row.id).join(',')} />
      {periods(visible)}
      {backlogCount > 0 && (
        <SectionDisclosure
          title={`${t.backlog} (${new Intl.NumberFormat(locale).format(backlogCount)})`}
          kind="history"
          id="overdue-tasks"
        >
          <p className="task-range-note">{t.backlogHelp}</p>
          {periods(backlog)}
        </SectionDisclosure>
      )}
    </div>
  );
}
