import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { calendarRows } from '@/features/calendar/queries';

export async function readCommunityRows(
  db: Pick<SupabaseClient<Database>, 'from'>,
  homeId: string,
  tab: string,
) {
  const [reasons, punishments, redemptions] = await Promise.all([
    tab === 'points' || tab === 'reasons'
      ? calendarRows(
          db
            .from('rating_reasons')
            .select('*')
            .eq('home_id', homeId)
            .order('kind')
            .order('name')
            .order('id'),
        )
      : [],
    tab === 'punishments'
      ? calendarRows(
          db
            .from('punishments')
            .select('*')
            .eq('home_id', homeId)
            .order('triggered_at', { ascending: false })
            .order('id'),
        )
      : [],
    tab === 'points'
      ? calendarRows(
          db
            .from('rating_redemptions')
            .select('*')
            .eq('home_id', homeId)
            .is('revoked_at', null)
            .order('id'),
        )
      : [],
  ]);
  return { reasons, punishments, redemptions };
}
