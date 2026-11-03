import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Database } from './supabase/database.types';
import { AVATAR_MAX_BYTES, validAvatarFile } from './profile-validation';
import { validImage } from './validation';

/** Best effort, using only the exchanged user's session. Never exposes a remote avatar URL. */
export async function importGoogleAvatar(
  db: SupabaseClient<Database>,
  user: User,
  download: typeof fetch = fetch,
): Promise<void> {
  try {
    if (
      !user.identities?.some((identity) => identity.provider === 'google') ||
      user.user_metadata.roomiehub_google_avatar_attempted
    )
      return;
    // Mark even skipped/failed imports: removing a photo must remain permanent.
    const { error: markError } = await db.auth.updateUser({
      data: { roomiehub_google_avatar_attempted: true },
    });
    if (markError) return;
    const { data: profile, error } = await db
      .from('profiles')
      .select('avatar_path')
      .eq('id', user.id)
      .maybeSingle();
    if (error || !profile || profile.avatar_path) return;
    const source = user.user_metadata.avatar_url || user.user_metadata.picture;
    if (typeof source !== 'string') return;
    const url = new URL(source);
    if (
      url.protocol !== 'https:' ||
      !url.hostname.endsWith('.googleusercontent.com') ||
      url.username ||
      url.password ||
      (url.port && url.port !== '443')
    )
      return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    let bytes: Uint8Array;
    try {
      const response = await download(url, {
        redirect: 'error',
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok || !response.body) return;
      if (Number(response.headers.get('content-length')) > AVATAR_MAX_BYTES) {
        controller.abort();
        await response.body.cancel();
        return;
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > AVATAR_MAX_BYTES) {
          controller.abort();
          await reader.cancel();
          return;
        }
        chunks.push(value);
      }
      bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
    } finally {
      clearTimeout(timer);
    }
    // Infer from the signature, never trust a URL extension or server MIME header.
    const mime = ['image/png', 'image/jpeg', 'image/webp'].find((type) => validImage(bytes, type));
    if (!mime || !validAvatarFile({ type: mime, size: bytes.byteLength })) return;
    const ext = mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'webp';
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
    const bucket = db.storage.from('avatars');
    const { error: uploadError } = await bucket.upload(path, bytes, {
      contentType: mime,
      upsert: false,
    });
    if (uploadError) return;
    // A concurrent manual upload wins. Remove our unused private object if it lost.
    const { data: updated, error: updateError } = await db
      .from('profiles')
      .update({ avatar_path: path })
      .eq('id', user.id)
      .is('avatar_path', null)
      .select('id')
      .maybeSingle();
    if (updateError || !updated) await bucket.remove([path]);
  } catch {
    // Optional profile enrichment must never invalidate authentication or log provider data.
  }
}
