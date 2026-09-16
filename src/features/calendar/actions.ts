'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { getHome, requireUser } from '@/lib/data';
import { i18n } from '@/lib/i18n/server';
import type { ActionState } from '@/app/actions';
import { calendarMessages } from './messages';
import { validLocalInput, formatInstant } from './logic';
const field = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const uuid = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
export async function calendarAction(
  homeId: string,
  operation: string,
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { locale } = await i18n(),
    t = calendarMessages(locale);
  let zone = 'UTC';
  try {
    const { db } = await requireUser(),
      home = await getHome(homeId);
    zone = home.timezone;
    const id = field(form, 'id'),
      version = Number(field(form, 'version'));
    if (operation !== 'initialize' && (!uuid(id) || !Number.isInteger(version) || version < 0))
      return { error: t.invalid };
    let result: { error: { message: string; code?: string; details?: string } | null };
    if (operation === 'initialize')
      result = await db.rpc('initialize_resources', { target: homeId, language_code: locale });
    else if (operation === 'resource') {
      const name = field(form, 'name'),
        description = field(form, 'description');
      if (!name || name.length > 100 || description.length > 2000) return { error: t.invalid };
      result = await db.rpc('save_resource', {
        target: homeId,
        item: id,
        expected_version: version,
        label: name,
        notes: description,
        enabled: field(form, 'active') === 'on',
      });
    } else if (operation === 'reservation' || operation === 'activity') {
      const start = field(form, 'start'),
        end = field(form, 'end'),
        title = field(form, 'title'),
        tz = field(form, 'timezone');
      if (!validLocalInput(start) || (end && !validLocalInput(end)) || title.length > 160)
        return { error: t.invalid };
      if (operation === 'reservation') {
        const resource = field(form, 'resource'),
          person = field(form, 'person');
        if (!uuid(resource) || !uuid(person) || !end) return { error: t.invalid };
        result = await db.rpc('save_reservation', {
          target: homeId,
          item: id,
          expected_version: version,
          resource,
          person,
          label: title,
          start_local: start,
          end_local: end,
          expected_timezone: tz,
        });
      } else {
        const notes = field(form, 'description'),
          place = field(form, 'location');
        if (!title || notes.length > 4000 || place.length > 300) return { error: t.invalid };
        result = await db.rpc('save_activity', {
          target: homeId,
          item: id,
          expected_version: version,
          label: title,
          notes,
          place,
          start_local: start,
          end_local: end || null,
          expected_timezone: tz,
        });
      }
    } else if (operation === 'cancel_reservation' || operation === 'cancel_activity') {
      if (field(form, 'confirm') !== 'on') return { error: t.invalid };
      result =
        operation === 'cancel_reservation'
          ? await db.rpc('cancel_reservation', {
              target: homeId,
              item: id,
              expected_version: version,
            })
          : await db.rpc('cancel_activity', {
              target: homeId,
              item: id,
              expected_version: version,
            });
    } else if (operation === 'attend')
      result = await db.rpc('set_activity_attendance', {
        target: homeId,
        item: id,
        joining: field(form, 'joining') === 'true',
      });
    else return { error: t.invalid };
    if (result.error) throw result.error;
    revalidatePath(`/homes/${homeId}`, 'layout');
    return { success: t.saved };
  } catch (e) {
    unstable_rethrow(e);
    const err = e as { message?: string; code?: string; details?: string };
    if (err.code === 'PGRST202' || err.code === '42P01') return { error: t.migration };
    if (err.message === 'reservation_conflict') {
      try {
        const detail = JSON.parse(err.details ?? '{}') as { starts_at: string; ends_at: string };
        return {
          error: t.conflictAt
            .replace('{start}', formatInstant(detail.starts_at, zone, locale))
            .replace('{end}', formatInstant(detail.ends_at, zone, locale)),
        };
      } catch {
        return { error: t.conflict };
      }
    }
    if (err.code === '23P01') return { error: t.conflict };
    if (err.message === 'stale_timezone') return { error: t.staleZone };
    if (err.message === 'nonexistent_local_time') return { error: t.gap };
    if (err.message === 'past_start') return { error: t.past };
    if (err.message === 'resource_unavailable') return { error: t.unavailable };
    if (err.message?.startsWith('closed_')) return { error: t.closed };
    if (err.message === 'stale_version' || err.message === 'idempotency_conflict')
      return { error: t.stale };
    if (
      err.message?.startsWith('invalid_') ||
      ['23514', '23502', '22007', '22008', '22P02'].includes(err.code ?? '')
    )
      return { error: t.invalid };
    return { error: t.error };
  }
}
