import test from 'node:test';
import assert from 'node:assert/strict';
import { serverModule } from './helpers/server-module';
import * as validation from '../src/lib/validation';
import * as profileValidation from '../src/lib/profile-validation';
import * as currencies from '../src/lib/currencies';
import * as timezones from '../src/lib/timezones';
import { es, en, type Messages } from '../src/lib/i18n/dictionaries';
import type { ActionState } from '../src/app/actions';

const id = '11111111-1111-4111-8111-111111111111';
const png = () =>
  new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'home.png', { type: 'image/png' });
async function harness(failure = '', t: Messages = es) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const uploads: string[] = [],
    removed: string[] = [],
    redirects: string[] = [];
  const db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data: id, error: failure === name ? { message: 'failure' } : null };
    },
    storage: {
      from: () => ({
        upload: async (path: string) => {
          uploads.push(path);
          return { error: failure === 'upload' ? {} : null };
        },
        remove: async (paths: string[]) => {
          removed.push(...paths);
        },
      }),
    },
  };
  const { homeAction } = await serverModule<{
    homeAction: (kind: string, previous: ActionState, form: FormData) => Promise<ActionState>;
  }>('src/app/actions.ts', {
    '@/features/expenses/messages': {},
    'next/headers': {},
    'next/cache': { revalidatePath: () => {} },
    'next/navigation': {
      redirect: (url: string) => {
        redirects.push(url);
        throw new Error('NEXT_REDIRECT');
      },
      unstable_rethrow: (e: Error) => {
        if (e.message === 'NEXT_REDIRECT') throw e;
      },
    },
    '@/lib/supabase/server': { supabase: async () => db },
    '@/lib/supabase/recovery': {},
    '@/lib/supabase/config': {},
    '@/lib/data': { requireUser: async () => ({ db }) },
    '@/lib/i18n/server': { i18n: async () => ({ t }) },
    '@/lib/validation': validation,
    '@/lib/profile-validation': profileValidation,
    '@/lib/currencies': currencies,
    '@/lib/timezones': timezones,
    '@/lib/auth-errors': {},
    '@/lib/auth-redirects': {},
  });
  const form = new FormData();
  form.set('name', 'New home');
  form.set('currency', 'GBP');
  form.set('timezone', 'Asia/Tokyo');
  return { run: () => homeAction('create', {}, form), form, calls, uploads, removed, redirects };
}
test('invalid name, currency, time zone and image never create a home', async () => {
  for (const t of [es, en])
    for (const [key, value] of [
      ['name', 'x'],
      ['currency', 'invalid'],
      ['timezone', 'Invalid/Zone'],
      ['image', new File(['bad'], 'bad.png', { type: 'image/png' })],
      ['image', new File([new Uint8Array(5242881)], 'large.png', { type: 'image/png' })],
      ['image', new File(['bad'], 'bad.svg', { type: 'image/svg+xml' })],
    ] as const) {
      const h = await harness('', t);
      h.form.set(key, value);
      assert.ok((await h.run()).error);
      assert.equal(h.calls.length, 0);
      assert.equal(h.uploads.length, 0);
    }
});
test('creation associates selected currency, time zone and private image with the returned home', async () => {
  const h = await harness();
  h.form.set('image', png());
  await assert.rejects(h.run(), /NEXT_REDIRECT/);
  assert.deepEqual(
    h.calls.map((c) => c.name),
    ['create_home', 'update_home_timezone', 'update_home'],
  );
  assert.equal(h.calls[0].args.home_currency, 'GBP');
  assert.equal(h.calls[1].args.target, id);
  assert.equal(h.calls[1].args.zone, 'Asia/Tokyo');
  assert.equal(h.calls[2].args.target, id);
  assert.equal(h.calls[2].args.home_image, h.uploads[0]);
  assert.ok(h.uploads[0].startsWith(`${id}/`));
  assert.deepEqual(h.redirects, [`/homes/${id}`]);
});
test('omitted optional settings use EUR and Europe/Madrid without uploading', async () => {
  const h = await harness();
  h.form.delete('currency');
  h.form.delete('timezone');
  await assert.rejects(h.run(), /NEXT_REDIRECT/);
  assert.equal(h.calls[0].args.home_currency, 'EUR');
  assert.equal(h.calls[1].args.zone, 'Europe/Madrid');
  assert.equal(h.uploads.length, 0);
});
test('post-creation failures leave a single home and navigate to a terminal recovery notice', async () => {
  for (const failure of ['update_home_timezone', 'upload', 'update_home']) {
    const h = await harness(failure);
    h.form.set('image', png());
    await assert.rejects(h.run(), /NEXT_REDIRECT/);
    assert.equal(h.calls.filter((c) => c.name === 'create_home').length, 1);
    assert.deepEqual(h.redirects, [`/homes/new?created=${id}`]);
    if (failure === 'update_home') assert.deepEqual(h.removed, h.uploads);
  }
});
