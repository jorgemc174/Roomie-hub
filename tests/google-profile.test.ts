import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Database } from '../src/lib/supabase/database.types';
import { importGoogleAvatar } from '../src/lib/google-profile';
import { AVATAR_MAX_BYTES } from '../src/lib/profile-validation';

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
function fixture(
  options: {
    avatar?: string;
    marked?: boolean;
    url?: string | null;
    provider?: string;
    failure?: string;
  } = {},
) {
  const calls: string[] = [];
  const user = {
    id: 'user-id',
    identities: [{ provider: options.provider ?? 'google' }],
    user_metadata: {
      avatar_url:
        options.url === undefined ? 'https://lh3.googleusercontent.com/photo' : options.url,
      roomiehub_google_avatar_attempted: options.marked,
    },
  } as unknown as User;
  let path: string | undefined;
  const query = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    is(column: string, value: null) {
      assert.equal(column, 'avatar_path');
      assert.equal(value, null);
      return this;
    },
    async maybeSingle() {
      return {
        data: path
          ? options.failure === 'race'
            ? null
            : { id: user.id }
          : { avatar_path: options.avatar ?? null },
        error: options.failure === 'update' && path ? {} : null,
      };
    },
    update(value: { avatar_path: string }) {
      calls.push('update');
      path = value.avatar_path;
      return this;
    },
  };
  const db = {
    from(table: string) {
      assert.equal(table, 'profiles');
      return query;
    },
    auth: {
      async updateUser(input: { data: { roomiehub_google_avatar_attempted: boolean } }) {
        calls.push('mark');
        user.user_metadata.roomiehub_google_avatar_attempted =
          input.data.roomiehub_google_avatar_attempted;
        return { error: options.failure === 'mark' ? {} : null };
      },
    },
    storage: {
      from(bucket: string) {
        assert.equal(bucket, 'avatars');
        return {
          async upload(
            key: string,
            bytes: Uint8Array,
            config: { contentType: string; upsert: boolean },
          ) {
            calls.push('upload');
            assert.match(key, /^user-id\/[\w-]+\.png$/);
            assert.deepEqual(bytes, png);
            assert.deepEqual(config, { contentType: 'image/png', upsert: false });
            return { error: options.failure === 'upload' ? {} : null };
          },
          async remove() {
            calls.push('remove');
          },
        };
      },
    },
  } as unknown as SupabaseClient<Database>;
  return { db, user, calls };
}
const download: typeof fetch = async (_url, options) => {
  assert.equal(options?.redirect, 'error');
  assert.ok(options?.signal);
  return new Response(png, { headers: { 'content-type': 'image/png' } });
};
test('imports Google avatar into private profile storage once', async () => {
  const f = fixture();
  await importGoogleAvatar(f.db, f.user, download);
  assert.deepEqual(f.calls, ['mark', 'upload', 'update']);
});
test('own photo, missing metadata, other providers and previous attempts are left alone', async () => {
  for (const options of [
    { avatar: 'own/photo.png' },
    { url: null },
    { provider: 'email' },
    { marked: true },
  ]) {
    const f = fixture(options);
    await importGoogleAvatar(f.db, f.user, async () => {
      throw Error('must not fetch');
    });
    assert.equal(f.calls.includes('upload'), false);
  }
});
test('untrusted URLs never reach fetch', async () => {
  for (const url of [
    'http://lh3.googleusercontent.com/a',
    'https://googleusercontent.com.evil.test/a',
    'https://evil.test/a',
    'https://googleusercontent.com/a',
    'https://user:pass@lh3.googleusercontent.com/a',
  ]) {
    const f = fixture({ url });
    let fetched = false;
    await importGoogleAvatar(f.db, f.user, async () => {
      fetched = true;
      throw Error();
    });
    assert.equal(fetched, false, url);
  }
});
test('download/redirect/HTTP/signature/oversize failures never escape or upload', async () => {
  const bad: (typeof fetch)[] = [
    async () => {
      throw Error('download/redirect failed');
    },
    async () => new Response(null, { status: 302, headers: { location: 'https://evil.test' } }),
    async () => new Response(null, { status: 503 }),
    async () => new Response('not an image', { headers: { 'content-type': 'image/png' } }),
    async () => new Response(png, { headers: { 'content-length': String(AVATAR_MAX_BYTES + 1) } }),
    async () => new Response(new Uint8Array(AVATAR_MAX_BYTES + 1)),
  ];
  for (const fetcher of bad) {
    const f = fixture();
    await assert.doesNotReject(importGoogleAvatar(f.db, f.user, fetcher));
    assert.equal(f.calls.includes('upload'), false);
  }
});
test('stream is cancelled as soon as the byte limit is exceeded', async () => {
  let cancelled = false;
  const f = fixture();
  await importGoogleAvatar(
    f.db,
    f.user,
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(AVATAR_MAX_BYTES));
            controller.enqueue(new Uint8Array(1));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  );
  assert.equal(cancelled, true);
  assert.equal(f.calls.includes('upload'), false);
});
test('metadata and storage failures never invalidate login', async () => {
  for (const failure of ['mark', 'upload']) {
    const f = fixture({ failure });
    await assert.doesNotReject(importGoogleAvatar(f.db, f.user, download));
    assert.equal(f.calls.includes('update'), false);
  }
});

test('deleted or deliberately absent avatar is not reimported on the next login', async () => {
  const f = fixture();
  await importGoogleAvatar(f.db, f.user, download);
  f.calls.length = 0;
  await importGoogleAvatar(f.db, f.user, download);
  assert.deepEqual(f.calls, []);
});
test('picture fallback and signature take priority over MIME headers', async () => {
  const f = fixture({ url: null });
  f.user.user_metadata.picture = 'https://lh3.googleusercontent.com/photo';
  await importGoogleAvatar(
    f.db,
    f.user,
    async () => new Response(png, { headers: { 'content-type': 'text/html' } }),
  );
  assert.deepEqual(f.calls, ['mark', 'upload', 'update']);
});
test('failed profile update or concurrent own photo cleans up unused storage', async () => {
  for (const failure of ['update', 'race']) {
    const f = fixture({ failure });
    await importGoogleAvatar(f.db, f.user, download);
    assert.deepEqual(f.calls, ['mark', 'upload', 'update', 'remove']);
  }
});
test('short timeout aborts a stalled download without invalidating login', async () => {
  const f = fixture();
  let aborted = false;
  await importGoogleAvatar(
    f.db,
    f.user,
    async (_url, options) =>
      new Promise((_resolve, reject) => {
        options!.signal!.addEventListener(
          'abort',
          () => {
            aborted = true;
            reject(Error('timeout'));
          },
          { once: true },
        );
      }),
  );
  assert.equal(aborted, true);
  assert.equal(f.calls.includes('upload'), false);
});
