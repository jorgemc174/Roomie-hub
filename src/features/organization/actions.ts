'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireUser } from '@/lib/data';
import { i18n } from '@/lib/i18n/server';
import type { ActionState } from '@/app/actions';
import { organizationMessages } from './messages';
import { validDate, validDifficulty } from './logic';
const field = (f: FormData, key: string) => String(f.get(key) ?? '').trim();
const uuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export async function organizationAction(
  homeId: string,
  operation: string,
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { locale } = await i18n();
  const t = organizationMessages(locale);
  try {
    const { db } = await requireUser();
    if (!uuid(homeId)) return { error: t.invalid };
    const id = field(form, 'id');
    if (id && !uuid(id)) return { error: t.invalid };
    let result: { error: { message: string; code?: string } | null };
    let success = t.saved;
    if (operation === 'save_chore') {
      const weight = Number(field(form, 'difficulty')),
        kind = field(form, 'recurrence'),
        n = Number(field(form, 'interval_count'));
      const anchor = field(form, 'anchor_date'),
        mode = field(form, 'assignment_mode'),
        name = field(form, 'name'),
        description = field(form, 'description');
      const rotation = form.getAll('rotation').map(String);
      const due = field(form, 'deadline') === 'on' ? Number(field(form, 'deadline_days')) : null;
      if (
        !validDifficulty(weight) ||
        !validDate(anchor) ||
        !['daily', 'days', 'weekly', 'weeks', 'monthly'].includes(kind) ||
        !Number.isInteger(n) ||
        n < 1 ||
        n > 365 ||
        !['automatic', 'manual'].includes(mode) ||
        !name ||
        name.length > 100 ||
        description.length > 2000 ||
        rotation.some((u) => !uuid(u)) ||
        new Set(rotation).size !== rotation.length ||
        (mode === 'manual' && !rotation.length) ||
        (due !== null && (!Number.isInteger(due) || due < 0 || due > 365))
      )
        return { error: t.invalid };
      result = await db.rpc('save_chore', {
        target: homeId,
        chore: id || null,
        task_name: name,
        task_description: description,
        weight,
        enabled: field(form, 'active') === 'on',
        kind,
        every_n: ['days', 'weeks'].includes(kind) ? n : 1,
        anchor,
        mode,
        rotation: mode === 'manual' ? rotation : [],
        due_days: due,
        due_time: field(form, 'deadline_time') || '20:00',
        due_timezone: field(form, 'deadline_timezone') || 'UTC',
      });
    } else if (operation === 'initialize') {
      result = await db.rpc('initialize_chores', { target: homeId, language_code: locale });
    } else if (operation === 'generate') {
      const from = field(form, 'from'),
        through = field(form, 'through');
      if (
        !validDate(from) ||
        !validDate(through) ||
        through < from ||
        Date.parse(through) - Date.parse(from) > 366 * 86400000
      )
        return { error: t.invalid };
      const generated = await db.rpc('generate_chore_instances', {
        target: homeId,
        from_date: from,
        through_date: through,
      });
      result = generated;
      success = generated.data?.blocked ? t.unavailable : t.generated;
    } else if (operation === 'complete_chore') {
      if (!uuid(id)) return { error: t.invalid };
      result = await db.rpc('complete_chore', { target: homeId, instance: id });
    } else if (operation === 'save_absence' || operation === 'delete_absence') {
      const person = field(form, 'person'),
        starts = field(form, 'start_date'),
        ends = field(form, 'end_date');
      if (!uuid(person) || !validDate(starts) || !validDate(ends) || ends < starts)
        return { error: t.invalid };
      result = await db.rpc('save_absence', {
        target: homeId,
        absence: id || null,
        person,
        starts,
        ends,
        remove: operation === 'delete_absence',
      });
    } else if (
      [
        'create_list',
        'rename_list',
        'delete_list',
        'add_item',
        'toggle_item',
        'delete_item',
        'complete_list',
      ].includes(operation)
    ) {
      const list = field(form, 'list_id'),
        item = field(form, 'item_id'),
        name = field(form, 'name');
      if (
        (list && !uuid(list)) ||
        (item && !uuid(item)) ||
        (['create_list', 'rename_list', 'add_item'].includes(operation) &&
          (!name || name.length > 100))
      )
        return { error: t.invalid };
      result = await db.rpc('shopping_command', {
        target: homeId,
        operation,
        list_id: list || null,
        item_id: item || null,
        label: name || null,
        checked: field(form, 'checked') !== 'false',
      });
    } else return { error: t.invalid };
    if (result.error) {
      const { message, code } = result.error;
      return {
        error:
          message === 'unauthorized'
            ? t.unauthorized
            : message === 'not_found'
              ? t.missing
              : message.startsWith('invalid_') ||
                  ['23514', '23502', '23505', '22P02', '22007', '22008'].includes(code ?? '')
                ? t.invalid
                : ['PGRST202', '42P01'].includes(code ?? '')
                  ? t.migration
                  : t.error,
      };
    }
    revalidatePath(`/homes/${homeId}`, 'layout');
    return { success };
  } catch (error) {
    unstable_rethrow(error);
    return { error: t.error };
  }
}
