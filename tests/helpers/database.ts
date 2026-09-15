import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
export async function organizationDatabase() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth,public,storage to authenticated,anon;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant select,insert,delete on storage.objects to authenticated;
    create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name,'/') $$;
    create publication supabase_realtime;`);
  for (const file of (await readdir('supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort())
    await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  const users = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
  ];
  for (const [index, id] of users.entries())
    await db.query('insert into auth.users values($1,$2)', [
      id,
      JSON.stringify({ name: ['Alice', 'Bob', 'Cara', 'Outsider'][index] }),
    ]);
  const as = async (id: string) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec('set role authenticated');
  };
  const scalar = async <T>(sql: string, args: unknown[] = []) =>
    (await db.query<{ v: T }>(sql, args)).rows[0]?.v;
  const home = async (count = 3) => {
    await as(users[0]);
    const h = await scalar<string>("select public.create_home('Test home') v");
    const code = await scalar<string>('select code v from public.invitations where home_id=$1', [
      h,
    ]);
    for (const u of users.slice(1, count)) {
      await as(u);
      await db.query('select public.join_home($1)', [code]);
    }
    await as(users[0]);
    return h;
  };
  return { db, users, as, scalar, home };
}
