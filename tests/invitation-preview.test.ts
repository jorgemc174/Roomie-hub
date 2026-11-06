import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { organizationDatabase } from './helpers/database';

test('invitation preview reveals only home identity, enforces auth and never joins', async () => {
  const { db, users, as, scalar, home } = await organizationDatabase('202609150001_foundation.sql');
  try {
    const migration = await readFile(
      'supabase/migrations/202611060001_invitation_preview.sql',
      'utf8',
    );
    assert.doesNotMatch(migration, /^\s*(begin|commit)\s*;/im);
    await db.exec('reset role');
    await db.exec(migration);
    const id = await home(1);
    const code = await scalar<string>('select code v from public.invitations where home_id=$1', [
      id,
    ]);
    const preview = (value: string | null) =>
      db.query<{ home_id: string; home_name: string; already_member: boolean }>(
        'select * from public.preview_invitation($1)',
        [value],
      );
    await as(users[1]);
    assert.equal((await db.query('select * from public.homes')).rows.length, 0);
    assert.deepEqual((await preview(` ${code!.toUpperCase()} `)).rows, [
      { home_id: id, home_name: 'Test home', already_member: false },
    ]);
    for (const invalid of [null, '', 'bad', '0'.repeat(32)])
      assert.deepEqual((await preview(invalid)).rows, []);
    assert.equal((await db.query('select * from public.homes')).rows.length, 0);
    await as(users[0]);
    assert.equal((await preview(code!)).rows[0].already_member, true);
    const replacement = await scalar<string>('select public.regenerate_invitation($1) v', [id]);
    assert.deepEqual((await preview(code!)).rows, []);
    await db.exec('reset role');
    await db.query('update public.home_members set active=false,left_at=now() where home_id=$1', [
      id,
    ]);
    await as(users[0]);
    assert.equal((await preview(replacement!)).rows[0].already_member, false);
    await as('');
    await assert.rejects(preview(replacement!), /unauthorized/);
    await db.exec('reset role; set role anon');
    await assert.rejects(preview(replacement!), /permission denied/);
    await db.exec('reset role');
    const config = await db.query<{ prosecdef: boolean; proconfig: string[] }>(
      "select prosecdef,proconfig from pg_proc where oid='public.preview_invitation(text)'::regprocedure",
    );
    assert.equal(config.rows[0].prosecdef, true);
    assert.ok(config.rows[0].proconfig.includes('search_path=""'));
    assert.equal(
      await scalar<boolean>(
        "select has_function_privilege('authenticated','public.preview_invitation(text)','execute') v",
      ),
      true,
    );
    assert.equal(
      await scalar<boolean>(
        "select has_function_privilege('anon','public.preview_invitation(text)','execute') v",
      ),
      false,
    );
  } finally {
    await db.close();
  }
});

test(
  'join page states render safely in both languages and all viewport sizes',
  { timeout: 120_000 },
  () => {
    execFileSync(process.execPath, ['tests/invitation-preview-render.mjs'], {
      stdio: 'pipe',
      timeout: 110_000,
    });
  },
);
