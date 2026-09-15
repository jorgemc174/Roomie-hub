import Link from 'next/link';
import { requireUser } from '@/lib/data';
import { i18n } from '@/lib/i18n/server';
import { organizationMessages } from './messages';
export async function OrganizationSummary({ homeId }: { homeId: string }) {
  const { db, user } = await requireUser();
  const { locale } = await i18n();
  const t = organizationMessages(locale);
  const now = new Date().getTime();
  const [tasks, items] = await Promise.all([
    db
      .from('chore_instances')
      .select('id,deadline_at')
      .eq('home_id', homeId)
      .eq('assignee_id', user.id)
      .is('completed_at', null)
      .lte('period_start', new Date().toISOString().slice(0, 10)),
    db
      .from('shopping_items')
      .select('id', { count: 'exact', head: true })
      .eq('home_id', homeId)
      .is('deleted_at', null)
      .eq('purchased', false),
  ]);
  return (
    <section className="panel org-summary">
      <h2>{t.summary}</h2>
      {tasks.error || items.error ? (
        <p>
          {['42P01', 'PGRST205'].includes(tasks.error?.code ?? items.error?.code ?? '')
            ? t.migration
            : t.loadError}
        </p>
      ) : (
        <div className="summary-counts">
          <Link href={`/homes/${homeId}/organization`}>
            <strong>{tasks.data?.length ?? 0}</strong>
            {t.pendingTasks}
          </Link>
          <Link href={`/homes/${homeId}/organization`}>
            <strong>
              {tasks.data?.filter((i) => i.deadline_at && Date.parse(i.deadline_at) < now)
                .length ?? 0}
            </strong>
            {t.overdueTasks}
          </Link>
          <Link href={`/homes/${homeId}/organization?tab=shopping`}>
            <strong>{items.count ?? 0}</strong>
            {t.pendingItems}
          </Link>
        </div>
      )}
      <Link className="text-link" href={`/homes/${homeId}/organization`}>
        {t.title} →
      </Link>
    </section>
  );
}
