import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
test('PostgreSQL: RLS, equal permissions, invitation lifecycle, storage and deletion', async (t) => {
  const db = new PGlite({ extensions: { btree_gist } });
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
 create schema auth; create schema storage;
 create table auth.users(id uuid primary key, raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth,public,storage to authenticated,anon;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner uuid,owner_id text,metadata jsonb,user_metadata jsonb);
 alter table storage.objects enable row level security;
 grant select,insert,delete on storage.objects to authenticated;
 create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name,'/') $$;
 create publication supabase_realtime;
 `);
    await db.exec(await readFile('supabase/migrations/202609150001_foundation.sql', 'utf8'));
    const alice = '11111111-1111-4111-8111-111111111111',
      bob = '22222222-2222-4222-8222-222222222222',
      eve = '33333333-3333-4333-8333-333333333333';
    for (const [id, name] of [
      [alice, 'Alice'],
      [bob, 'Bob'],
      [eve, 'Eve'],
    ])
      await db.query(`insert into auth.users values($1,$2)`, [id, JSON.stringify({ name })]);
    const as = async (id: string) => {
      await db.exec('reset role');
      await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [id]);
      await db.exec('set role authenticated');
    };
    const scalar = async <T>(sql: string, params: unknown[] = []) => {
      const result = await db.query<{ value: T }>(sql, params);
      return result.rows[0]?.value;
    };
    await as(alice);
    const home = await scalar<string>(`select public.create_home('Casa Sol','EUR') as value`);
    const code = await scalar<string>(
      'select code as value from public.invitations where home_id=$1',
      [home],
    );
    // Upgrade a populated phase-1 database; do not rewrite its initial migration.
    await assert.rejects(db.query("select public.create_home('Japanese home','JPY')"));
    await db.exec('reset role');
    for (const file of (await readdir('supabase/migrations'))
      .filter((file) => !file.endsWith('_scheduler.sql') && file.endsWith('.sql') && file !== '202609150001_foundation.sql')
      .sort()) {
      await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
    }
    await as(alice);
    await t.test(
      'currency migration preserves existing data/default and supports international formats',
      async () => {
        assert.equal(
          await scalar<string>('select currency as value from public.homes where id=$1', [home]),
          'EUR',
        );
        for (const currency of ['JPY', 'CHF', 'MXN', 'AED', 'BHD']) {
          const id = await scalar<string>('select public.create_home($1,$2) as value', [
            'International home',
            currency,
          ]);
          assert.equal(
            await scalar<string>('select currency as value from public.homes where id=$1', [id]),
            currency,
          );
          await db.query('select public.update_home($1,$2,$3,null,1::smallint)', [
            id,
            'Updated home',
            'KRW',
          ]);
          await db.query('select public.delete_home($1)', [id]);
        }
        for (const invalid of ['eur', 'EU', 'EURO', 'E1R', '€UR', 'EUR\n', ' EUR', '']) {
          await assert.rejects(
            db.query('select public.create_home($1,$2)', ['Invalid home', invalid]),
          );
          await assert.rejects(
            db.query('select public.update_home($1,$2,$3,null,1::smallint)', [
              home,
              'Invalid home',
              invalid,
            ]),
          );
        }
        const defaultHome = await scalar<string>(
          "select public.create_home('Default home') as value",
        );
        assert.equal(
          await scalar<string>('select currency as value from public.homes where id=$1', [
            defaultHome,
          ]),
          'EUR',
        );
        await db.query('select public.delete_home($1)', [defaultHome]);
      },
    );
    await t.test('creation atomically creates home, member, invitation and profile', async () => {
      assert.ok(home);
      assert.match(code, /^[a-f0-9]{32}$/);
      assert.equal(
        await scalar<number>('select count(*)::int as value from public.home_members'),
        1,
      );
      assert.equal(
        await scalar<string>('select name as value from public.profiles where id=$1', [alice]),
        'Alice',
      );
    });
    await t.test('nonmembers cannot read any home data or edit another profile', async () => {
      await as(eve);
      for (const table of ['homes', 'home_members', 'invitations'])
        assert.equal(await scalar<number>(`select count(*)::int as value from public.${table}`), 0);
      assert.equal(await scalar<number>('select count(*)::int as value from public.profiles'), 1);
      assert.equal(
        (
          await db.query('update public.profiles set name=$1 where id=$2 returning id', [
            'Hacked',
            alice,
          ])
        ).rows.length,
        0,
      );
      await assert.rejects(
        db.query('select public.update_home($1,$2,$3,null,1::smallint)', [home, 'Hacked', 'EUR']),
      );
      await assert.rejects(db.query('select public.regenerate_invitation($1)', [home]));
      await assert.rejects(db.query('select public.delete_home($1)', [home]));
    });
    await t.test('direct membership and home mutations are forbidden', async () => {
      await as(alice);
      await assert.rejects(
        db.query('insert into public.home_members(home_id,user_id) values($1,$2)', [home, eve]),
      );
      await assert.rejects(db.query('delete from public.homes where id=$1', [home]));
      await assert.rejects(db.query('update public.invitations set code=$1', ['known-code']));
    });
    await t.test('joining is direct, idempotent and gives equal edit permissions', async () => {
      await as(bob);
      assert.equal(await scalar<string>('select public.join_home($1) as value', [code]), home);
      await db.query('select public.join_home($1)', [code.toUpperCase()]);
      assert.equal(
        await scalar<number>('select count(*)::int as value from public.home_members'),
        2,
      );
      await db.query('select public.update_home($1,$2,$3,null,0::smallint)', [
        home,
        'Casa Luna',
        'USD',
      ]);
      assert.equal(await scalar<string>('select name as value from public.homes'), 'Casa Luna');
      await assert.rejects(db.query('select public.delete_home($1)', [home]), /home_has_members/);
    });
    await t.test('regeneration revokes the previous permanent invitation', async () => {
      const newCode = await scalar<string>('select public.regenerate_invitation($1) as value', [
        home,
      ]);
      assert.notEqual(newCode, code);
      await as(eve);
      await assert.rejects(db.query('select public.join_home($1)', [code]), /invalid_invitation/);
      await assert.rejects(db.query('select public.join_home($1)', ['bad']), /invalid_invitation/);
    });
    await t.test(
      'multiple homes remain isolated and cross-home image references fail',
      async () => {
        await as(alice);
        const other = await scalar<string>(
          "select public.create_home('Segundo piso','GBP') as value",
        );
        assert.equal(await scalar<number>('select count(*)::int as value from public.homes'), 2);
        await assert.rejects(
          db.query('select public.update_home($1,$2,$3,$4,1::smallint)', [
            home,
            'Casa Luna',
            'USD',
            `${other}/photo.png`,
          ]),
        );
        await as(bob);
        assert.equal(await scalar<number>('select count(*)::int as value from public.homes'), 1);
        assert.equal(
          await scalar<number>('select count(*)::int as value from public.homes where id=$1', [
            other,
          ]),
          0,
        );
        await assert.rejects(
          db.query('select public.update_home($1,$2,$3,null,1::smallint)', [
            other,
            'Intrusion',
            'GBP',
          ]),
        );
        await as(alice);
        await db.query('select public.delete_home($1)', [other]);
      },
    );
    await t.test('private files and image references stay within the home/user', async () => {
      await as(alice);
      await assert.rejects(
        db.query('insert into storage.objects(bucket_id,name) values($1,$2)', [
          'avatars',
          `${alice}/malware.exe`,
        ]),
      );
      await assert.rejects(
        db.query('insert into storage.objects(bucket_id,name) values($1,$2)', [
          'home-images',
          `${home}/malware.exe`,
        ]),
      );
      await db.query('insert into storage.objects(bucket_id,name) values($1,$2)', [
        'home-images',
        `${home}/photo.png`,
      ]);
      await db.query('insert into storage.objects(bucket_id,name) values($1,$2)', [
        'avatars',
        `${alice}/photo.png`,
      ]);
      await as(bob);
      assert.equal(await scalar<number>('select count(*)::int as value from storage.objects'), 2);
      await assert.rejects(
        db.query('update public.profiles set avatar_path=$1 where id=$2', [
          `${alice}/photo.png`,
          bob,
        ]),
      );
      await as(eve);
      assert.equal(await scalar<number>('select count(*)::int as value from storage.objects'), 0);
      await assert.rejects(
        db.query('insert into storage.objects(bucket_id,name) values($1,$2)', [
          'home-images',
          `${home}/evil.png`,
        ]),
      );
      await assert.rejects(db.query('delete from public.profiles where id=$1', [alice]));
    });
    await t.test('inactive members lose access and historical membership remains', async () => {
      await db.exec('reset role');
      await db.query('update public.home_members set active=false,left_at=now() where user_id=$1', [
        bob,
      ]);
      await as(bob);
      assert.equal(await scalar<number>('select count(*)::int as value from public.homes'), 0);
      await as(alice);
      assert.equal(
        await scalar<number>('select count(*)::int as value from public.home_members'),
        2,
      );
    });
    await t.test(
      'profile and avatar privacy ends at the last shared active membership',
      async () => {
        // Bob has left home in the preceding test. Alice must not see his future profile.
        await as(bob);
        await db.query('update public.profiles set name=$1 where id=$2', ['Private Bob', bob]);
        assert.equal(
          await scalar<string>('select name as value from public.profiles where id=$1', [bob]),
          'Private Bob',
        );
        assert.equal(
          await scalar<number>('select count(*)::int as value from public.profiles where id=$1', [
            alice,
          ]),
          0,
        );
        assert.equal(
          await scalar<number>(
            "select count(*)::int as value from storage.objects where bucket_id='avatars'",
          ),
          0,
        );
        await as(alice);
        assert.equal(
          await scalar<number>('select count(*)::int as value from public.profiles where id=$1', [
            bob,
          ]),
          0,
        );
        const other = await scalar<string>("select public.create_home('Still shared') as value");
        const invite = await scalar<string>(
          'select code as value from public.invitations where home_id=$1',
          [other],
        );
        await as(bob);
        await db.query('select public.join_home($1)', [invite]);
        assert.equal(
          await scalar<number>('select count(*)::int as value from public.profiles where id=$1', [
            alice,
          ]),
          1,
        );
        assert.equal(
          await scalar<number>(
            "select count(*)::int as value from storage.objects where bucket_id='avatars'",
          ),
          1,
        );
        await as(alice);
        assert.equal(
          await scalar<string>('select name as value from public.profiles where id=$1', [bob]),
          'Private Bob',
        );
        await db.exec('reset role');
        await db.query(
          'update public.home_members set active=false,left_at=now() where home_id=$1 and user_id=$2',
          [other, bob],
        );
        await as(alice);
        assert.equal(
          await scalar<number>('select count(*)::int as value from public.profiles where id=$1', [
            bob,
          ]),
          0,
        );
        assert.equal(
          await scalar<number>('select count(*)::int as value from public.profiles where id=$1', [
            alice,
          ]),
          1,
        );
        await db.query('select public.delete_home($1)', [other]);
      },
    );
    await t.test('only last active member can delete and children cascade', async () => {
      await as(alice);
      await db.query('select public.delete_home($1)', [home]);
      assert.equal(await scalar<number>('select count(*)::int as value from public.homes'), 0);
      await db.exec('reset role');
      assert.equal(
        await scalar<number>('select count(*)::int as value from public.invitations'),
        0,
      );
      assert.equal(
        await scalar<number>('select count(*)::int as value from public.home_members'),
        0,
      );
    });
    await t.test('anonymous callers cannot use RPCs', async () => {
      await db.exec('reset role; set role anon');
      await assert.rejects(db.query(`select public.create_home('Bad','EUR')`));
      await assert.rejects(db.query('select * from public.homes'));
    });
  } finally {
    await db.close();
  }
});
