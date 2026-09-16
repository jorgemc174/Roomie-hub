import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

export async function checkTaskHardening({ a, b, c, rpc, read, homes, page, base }) {
  const h = await rpc(a.client, 'create_home', { home_name: 'QA lifecycle hardening' });
  homes.push({ id: h, owner: a });
  await rpc(a.client, 'update_home_timezone', { target: h, zone: 'UTC' });
  const today = await rpc(a.client, 'home_local_date', { target: h });
  const day = (n) => new Date(Date.parse(today) + n * 86400000).toISOString().slice(0, 10);
  const args = {
    target: h,
    chore: null,
    task_name: 'QA lifecycle',
    task_description: '',
    weight: 3,
    enabled: true,
    kind: 'daily',
    every_n: 1,
    anchor: today,
    mode: 'automatic',
    rotation: [],
    due_days: 1,
    due_time: '20:00',
    due_timezone: 'Europe/Madrid',
  };
  const chore = await rpc(a.client, 'save_chore', args);
  if (page) {
    for (const tab of ['shopping', 'absences']) {
      await page.goto(`${base}/homes/${h}/organization?tab=${tab}`);
      await expect(
        page.getByRole('heading', {
          name: tab === 'shopping' ? 'Compra' : 'Ausencias',
          exact: true,
        }),
      ).toBeVisible();
      await page.waitForLoadState('networkidle');
      assert.equal(
        (await read(a.client, 'chore_instances', h)).length,
        0,
        `${tab} must not generate instances`,
      );
    }
    // Browsing an arbitrary future date still only ensures today/tomorrow, never that window.
    await page.goto(`${base}/homes/${h}/organization?from=${day(100)}`);
    await expect(page.getByRole('heading', { name: 'Tareas', exact: true })).toBeVisible();
    await page.waitForLoadState('networkidle');
    const generated = await read(a.client, 'chore_instances', h);
    assert.equal(generated.length, 2);
    assert.ok(generated.every((i) => i.period_start <= day(1)));
    // Leave the task page so realtime refreshes do not generate during API lifecycle assertions.
    await page.goto(`${base}/homes/${h}/organization?tab=shopping`);
    await page.waitForLoadState('networkidle');
  }
  await rpc(a.client, 'generate_chore_instances', {
    target: h,
    from_date: today,
    through_date: day(14),
  });
  const initial = await read(a.client, 'chore_instances', h);
  const current = initial.find((i) => i.period_start === today),
    completed = initial.find((i) => i.period_start === day(5));
  await rpc(a.client, 'complete_chore', { target: h, instance: completed.id });
  const closed = (await read(a.client, 'chore_instances', h)).find((i) => i.id === completed.id);
  await rpc(a.client, 'save_chore', { ...args, chore, enabled: false });
  const disabled = await read(a.client, 'chore_instances', h);
  assert.deepEqual(
    disabled.find((i) => i.id === current.id),
    current,
  );
  assert.deepEqual(
    disabled.find((i) => i.id === closed.id),
    closed,
  );
  assert.equal(disabled.filter((i) => i.cancelled_at).length, 13);
  assert.equal((await rpc(a.client, 'ensure_current_chores', { target: h })).created, 0);
  await rpc(a.client, 'save_chore', { ...args, chore, kind: 'weekly', weight: 5 });
  await rpc(a.client, 'generate_chore_instances', {
    target: h,
    from_date: today,
    through_date: day(21),
  });
  assert.ok(
    (await read(a.client, 'chore_instances', h))
      .filter((i) => !i.cancelled_at && i.id !== current.id && i.id !== closed.id)
      .every((i) => i.difficulty === 5),
  );
  const code = (await read(a.client, 'invitations', h))[0].code;
  await rpc(b.client, 'join_home', { invite_code: code });
  assert.equal(
    (await read(a.client, 'chore_instances', h)).filter(
      (i) => !i.cancelled_at && i.period_start > today && i.completed_at === null,
    ).length,
    0,
  );
  // Return to daily for a predictable next-day candidate. Newcomer has zero historical load.
  await rpc(a.client, 'save_chore', { ...args, chore });
  await rpc(a.client, 'ensure_current_chores', { target: h });
  assert.equal(
    (await read(a.client, 'chore_instances', h)).find(
      (i) => !i.cancelled_at && i.period_start === day(1),
    ).assignee_id,
    b.id,
  );
  await rpc(a.client, 'save_chore', { ...args, chore, mode: 'manual', rotation: [b.id, a.id] });
  await rpc(a.client, 'ensure_current_chores', { target: h });
  assert.equal(
    (await read(a.client, 'chore_instances', h)).find(
      (i) => !i.cancelled_at && i.period_start === day(1),
    ).assignee_id,
    b.id,
  );
  assert.equal((await rpc(a.client, 'ensure_current_chores', { target: h })).created, 0);
  await rpc(a.client, 'update_home_timezone', { target: h, zone: 'Asia/Tokyo' });
  assert.equal(
    await rpc(a.client, 'home_local_date', { target: h, at_instant: '2026-09-15T22:30:00Z' }),
    '2026-09-16',
  );
  assert.deepEqual(
    (await read(a.client, 'chore_instances', h)).find((i) => i.id === closed.id),
    closed,
  );
  assert.equal((await read(c.client, 'chore_instances', h)).length, 0);
  assert.ok((await c.client.rpc('ensure_current_chores', { target: h })).error);
  console.log(
    'PASS remote hardening: no generation in Shopping/Absences, bounded horizon, cancellation/history, recurrence/rotation, newcomer, timezone and RLS',
  );
}
