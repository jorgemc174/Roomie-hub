'use server';
import { createHash } from 'node:crypto';
import { unstable_rethrow } from 'next/navigation';
import { requireUser } from '@/lib/data';
import { i18n } from '@/lib/i18n/server';
import { chatMessages } from './messages';
import { validUuid } from './logic';
import { sanitizeChatFile } from './files';
export async function chatCommand(
  homeId: string,
  operation: string,
  form: FormData,
): Promise<{ ok?: string; error?: string }> {
  const { locale } = await i18n(),
    t = chatMessages(locale);
  try {
    const { db } = await requireUser();
    const id = String(form.get('id') ?? ''),
      v = Number(form.get('version'));
    if (!validUuid(homeId) || !validUuid(id)) return { error: t.invalid };
    let result: { error: { message: string } | null };
    if (operation === 'send') {
      const body = String(form.get('body') ?? '').replace(/\r\n/g, '\n'),
        reply = String(form.get('reply') ?? '');
      if (body.length > 4000 || (reply && !validUuid(reply))) return { error: t.invalid };
      const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
      const fileIds = form.getAll('file_ids').map(String);
      if (
        files.length > 3 ||
        fileIds.length !== files.length ||
        fileIds.some((id) => !validUuid(id))
      )
        return { error: t.invalid };
      const uploads = await Promise.all(
        files.map(async (f) =>
          sanitizeChatFile(new Uint8Array(await f.arrayBuffer()), f.type, f.name),
        ),
      );
      const ids: string[] = [];
      for (const [index, file] of uploads.entries()) {
        const item = fileIds[index];
        const prepared = await db.rpc('prepare_chat_attachment', {
          target: homeId,
          item,
          label: file.name,
          media_type: file.mime,
          byte_size: file.bytes.length,
          content_hash: createHash('sha256').update(file.bytes).digest('hex'),
        });
        if (prepared.error) throw prepared.error;
        const existing = await db.storage.from('chat-files').info(prepared.data);
        if (!existing.data) {
          const uploaded = await db.storage
            .from('chat-files')
            .upload(prepared.data, file.bytes, {
              contentType: file.mime,
              cacheControl: '0',
              headers: { 'cache-control': 'private, no-store, max-age=0' },
              upsert: false,
            });
          if (uploaded.error) throw uploaded.error;
        }
        ids.push(item);
      }
      result = await db.rpc('send_chat_message', {
        target: homeId,
        item: id,
        message_body: body,
        reply: reply || null,
        files: ids,
      });
    } else if (operation === 'edit')
      result = await db.rpc('edit_chat_message', {
        target: homeId,
        item: id,
        expected_version: v,
        message_body: String(form.get('body') ?? '').replace(/\r\n/g, '\n'),
      });
    else if (operation === 'delete')
      result = await db.rpc('delete_chat_message', {
        target: homeId,
        item: id,
        expected_version: v,
      });
    else if (operation === 'reaction')
      result = await db.rpc('set_chat_reaction', {
        target: homeId,
        item: id,
        reaction: String(form.get('emoji')),
        enabled: form.get('enabled') === 'true',
      });
    else return { error: t.invalid };
    if (result.error) throw result.error;
    return { ok: id };
  } catch (e) {
    unstable_rethrow(e);
    const message = (e as { message?: string }).message;
    return {
      error:
        message === 'rate_limited'
          ? t.rate
          : message === 'not_author'
            ? t.author
            : message === 'stale_version' || message === 'idempotency_conflict'
              ? t.stale
              : message?.startsWith('invalid_')
                ? t.invalid
                : t.error,
    };
  }
}
