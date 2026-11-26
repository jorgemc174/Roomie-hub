import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { organizationDatabase } from './helpers/database';

test('Predefined consequences: members manage a per-home list without touching history', async () => {
  const { db, as, users, home, scalar } = await organizationDatabase();
  const [a, b, , out] = users;
  const h = await home(2);
  const save = (id: string, version: number, label: string, level = '') =>
    scalar<string>('select public.save_punishment_preset($1,$2,$3,$4,$5) v', [
      h,
      id,
      version,
      label,
      level,
    ]);
  const rows = async () =>
    (
      await db.query<{ description: string; severity: string | null; version: number }>(
        'select description,severity,version from public.punishment_presets where home_id=$1 order by description',
        [h],
      )
    ).rows;

  // Any active member creates; text is normalised and the creation retry is idempotent.
  await as(b);
  const kitchen = randomUUID();
  assert.equal(await save(kitchen, 0, '  Limpiar   la cocina ', 'light'), kitchen);
  assert.equal(await save(kitchen, 0, 'Limpiar la cocina', 'light'), kitchen);
  const any = randomUUID();
  await save(any, 0, 'Bajar la basura una semana');
  assert.deepEqual(await rows(), [
    { description: 'Bajar la basura una semana', severity: null, version: 1 },
    { description: 'Limpiar la cocina', severity: 'light', version: 1 },
  ]);

  // Duplicates (case-insensitive), invalid input and stale versions are rejected.
  await assert.rejects(save(randomUUID(), 0, 'limpiar LA cocina'), /duplicate_preset/);
  await assert.rejects(save(randomUUID(), 0, '   '), /invalid_preset/);
  await assert.rejects(save(randomUUID(), 0, 'x'.repeat(501)), /invalid_preset/);
  await assert.rejects(save(randomUUID(), 0, 'Otro', 'medium'), /invalid_preset/);
  await as(a);
  assert.equal(await save(kitchen, 1, 'Limpiar la cocina y el horno', 'heavy'), kitchen);
  await assert.rejects(save(kitchen, 1, 'Viejo'), /stale_version/);
  await assert.rejects(save(any, 1, 'Limpiar la cocina y el horno'), /duplicate_preset/);

  // A consequence keeps its own copied text after the preset changes or disappears.
  await db.exec('reset role');
  await db.query(
    "insert into public.punishments(home_id,user_id,user_name,threshold,severity,description) values($1,$2,'Bob',5,'light','Limpiar la cocina y el horno')",
    [h, b],
  );
  await as(a);
  await assert.rejects(
    db.query('select public.delete_punishment_preset($1,$2,1)', [h, kitchen]),
    /stale_version/,
  );
  await db.query('select public.delete_punishment_preset($1,$2,2)', [h, kitchen]);
  await db.query('select public.delete_punishment_preset($1,$2,2)', [h, kitchen]);
  assert.deepEqual(
    (await rows()).map((r) => r.description),
    ['Bajar la basura una semana'],
  );
  assert.equal(
    await scalar<string>('select description v from public.punishments where home_id=$1', [h]),
    'Limpiar la cocina y el horno',
  );

  // Outsiders cannot read or write; direct table writes stay closed to members.
  await as(out);
  assert.equal(
    await scalar<number>('select count(*)::int v from public.punishment_presets where home_id=$1', [
      h,
    ]),
    0,
  );
  await assert.rejects(save(randomUUID(), 0, 'Intruso'), /unauthorized/);
  await as(b);
  await assert.rejects(
    db.query(
      "insert into public.punishment_presets(id,home_id,description) values(gen_random_uuid(),$1,'Directo')",
      [h],
    ),
    /permission denied/,
  );
  await assert.rejects(
    db.query('delete from public.punishment_presets where home_id=$1', [h]).then((r) => {
      if (!r.affectedRows) throw new Error('permission denied');
    }),
    /permission denied/,
  );
  assert.equal(
    await scalar<number>('select count(*)::int v from public.punishment_presets where home_id=$1', [
      h,
    ]),
    1,
  );
});
