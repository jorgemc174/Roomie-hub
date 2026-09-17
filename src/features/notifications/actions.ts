'use server';
import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/data';
import { i18n } from '@/lib/i18n/server';
import type { ActionState } from '@/app/actions';
import { notificationMessages } from './messages';
import { categories } from './models';
import { validUuid } from '@/features/chat/logic';
export async function preferenceAction(_state: ActionState, form: FormData): Promise<ActionState> {
  const { locale } = await i18n(),
    t = notificationMessages(locale);
  try {
    const { db } = await requireUser();
    const group = String(form.get('category'));
    if (!categories.some((c) => c === group)) return { error: t.error };
    const { error } = await db.rpc('save_notification_preferences', {
      group_name: group,
      app_enabled: form.has('app'),
      email_enabled: form.has('email'),
      push_enabled: form.has('push'),
      offsets: form.getAll('offsets').map(Number),
      expected_version: Number(form.get('version')),
    });
    if (error) return { error: t.error };
    revalidatePath('/notifications/preferences');
    return { success: t.saved };
  } catch (e) {
    unstable_rethrow(e);
    return { error: t.error };
  }
}
export async function readNotices(item?: string) {
  const { db } = await requireUser();
  if (item && !validUuid(item)) return false;
  const { error } = await db.rpc('mark_notifications_read', { item: item ?? null });
  return !error;
}
export async function registerPush(value: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}) {
  const { db } = await requireUser();
  const { data, error } = await db.rpc('save_push_subscription', {
    push_endpoint: value.endpoint,
    public_key: value.keys.p256dh,
    auth_secret: value.keys.auth,
    device_label: 'Browser',
  });
  return error ? null : data;
}
export async function revokePush(item: string) {
  const { db } = await requireUser();
  if (!validUuid(item)) return false;
  const { error } = await db.rpc('revoke_push_subscription', { item });
  return !error;
}
