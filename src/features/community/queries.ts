import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { calendarRows } from '@/features/calendar/queries';
import { readRows } from '@/features/organization/read-rows';
import type { PunishmentPreset } from './models';

// Presets are optional until migration 202611260001 is applied: null keeps the rest of Convivencia working.
async function readPresets(db: Pick<SupabaseClient<Database>, 'from'>, homeId: string) {
  const r = await readRows<PunishmentPreset>(
    db
      .from('punishment_presets')
      .select('*')
      .eq('home_id', homeId)
      .order('description')
      .order('id'),
  );
  if (r.error && ['PGRST205', '42P01'].includes(r.error.code)) return null;
  if (r.error) throw r.error;
  return r.data;
}

export async function readCommunityRows(
  db: Pick<SupabaseClient<Database>, 'from'>,
  homeId: string,
  tab: string,
) {
  const [reasons, punishments, redemptions, presets] = await Promise.all([
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
    tab === 'punishments' || tab === 'reasons' ? readPresets(db, homeId) : [],
  ]);
  return { reasons, punishments, redemptions, presets };
}
