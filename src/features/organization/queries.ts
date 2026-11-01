import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { readRows } from './read-rows';
import type { AssignmentEvent } from './models';

// Only read data rendered by the selected tab. Auth, generation and reconciliation
// remain in the page, and all reads keep the existing home filters and pagination.
export async function readOrganizationRows(
  db: Pick<SupabaseClient<Database>, 'from'>,
  homeId: string,
  tab: 'tasks' | 'shopping' | 'absences',
  from: string,
  through: string,
  selection: { view: string; userId: string } = { view: 'all', userId: '' },
) {
  const taskQuery = db
    .from('chore_instances')
    .select('*')
    .eq('home_id', homeId)
    .or(`period_end.gt.${from},completed_at.is.null`)
    .lte('period_start', through);
  if (selection.view === 'cancelled') taskQuery.not('cancelled_at', 'is', null);
  else taskQuery.is('cancelled_at', null);
  if (selection.view === 'mine') taskQuery.eq('assignee_id', selection.userId);
  const [chores, rotations, instances, absences, lists, items] = await Promise.all([
    tab === 'tasks'
      ? readRows(
          db.from('chores').select('*').eq('home_id', homeId).order('created_at').order('id'),
        )
      : { data: [], error: null },
    tab === 'tasks'
      ? readRows(
          db
            .from('chore_rotation_members')
            .select('*')
            .eq('home_id', homeId)
            .order('chore_id')
            .order('position'),
        )
      : { data: [], error: null },
    tab === 'tasks' && selection.view !== 'manage'
      ? readRows(taskQuery.order('period_start').order('id'))
      : { data: [], error: null },
    tab === 'absences'
      ? readRows(
          db
            .from('absences')
            .select('*')
            .eq('home_id', homeId)
            .is('deleted_at', null)
            .gte('end_date', from)
            .order('start_date')
            .order('id'),
        )
      : { data: [], error: null },
    tab === 'shopping'
      ? readRows(
          db
            .from('shopping_lists')
            .select('*')
            .eq('home_id', homeId)
            .is('deleted_at', null)
            .order('created_at')
            .order('id'),
        )
      : { data: [], error: null },
    tab === 'shopping'
      ? readRows(
          db
            .from('shopping_items')
            .select('*')
            .eq('home_id', homeId)
            .is('deleted_at', null)
            .order('created_at')
            .order('id'),
        )
      : { data: [], error: null },
  ]);
  // Events are presentation history only. Assignment/reconciliation stays in SQL.
  // Batch IDs to keep PostgREST URLs bounded, retaining every event for visible instances.
  const ids = (instances.data ?? []).map((i) => i.id);
  const data: AssignmentEvent[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const events = await readRows(
      db
        .from('chore_assignment_events')
        .select('*')
        .eq('home_id', homeId)
        .in('instance_id', ids.slice(offset, offset + 100))
        .order('created_at')
        .order('id'),
    );
    if (events.error) return { chores, rotations, instances, absences, lists, items, events };
    data.push(...events.data);
  }
  const events = { data, error: null };
  return { chores, rotations, instances, absences, lists, items, events };
}
