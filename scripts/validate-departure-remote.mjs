// Development integration: admin only prepares dated fixtures and cleans them up.
import { createClient } from '@supabase/supabase-js';
import { randomUUID, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
process.loadEnvFile('.env.local');
const e = process.env,
  options = { auth: { persistSession: false, autoRefreshToken: false } };
const client = () =>
  createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
const admin = createClient(
  e.NEXT_PUBLIC_SUPABASE_URL,
  e.SUPABASE_SECRET_KEY || e.SUPABASE_SERVICE_ROLE_KEY,
  options,
);
const accounts = [],
  homes = [];
const result = async (query) => {
  const r = await query;
  if (r.error) throw new Error(`${r.error.code ?? ''}: ${r.error.message}`);
  return r;
};
const rows = async (query) => (await result(query)).data;
const rpc = (c, name, args) => rows(c.rpc(name, args));
try {
  for (const name of ['Ana', 'Bob']) {
    const email = `roomiehub-departure-${randomUUID()}@example.com`,
      password = `Aa1!${randomBytes(18).toString('hex')}`;
    const r = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: `QA ${name}` },
    });
    if (r.error) throw r.error;
    const u = { id: r.data.user.id, c: client() };
    accounts.push(u);
    const login = await u.c.auth.signInWithPassword({ email, password });
    if (login.error) throw login.error;
  }
  const [a, b] = accounts;
  for (const days of [4, 5, 1003]) {
    const h = await rpc(a.c, 'create_home', {
      home_name: `QA departure ${days}`,
      home_currency: 'EUR',
    });
    homes.push(h);
    const inv = await rows(a.c.from('invitations').select('code').eq('home_id', h).single());
    await rpc(b.c, 'join_home', { invite_code: inv.code });
    const at = Date.now(),
      day = (ms) => new Date(ms).toISOString().slice(0, 10),
      old = new Date(at - 2000 * 86400000).toISOString();
    await rows(admin.from('home_members').update({ joined_at: old }).eq('home_id', h));
    const chore = await rows(
      admin
        .from('chores')
        .insert({
          home_id: h,
          name: 'QA departure task',
          difficulty: 1,
          recurrence: 'daily',
          anchor_date: day(at - 1100 * 86400000),
          assignment_mode: 'automatic',
        })
        .select('id')
        .single(),
    );
    const i = await rows(
      admin
        .from('chore_instances')
        .insert({
          home_id: h,
          chore_id: chore.id,
          period_start: day(at - 1100 * 86400000),
          period_end: day(at - 86400000),
          task_name: 'QA departure task',
          difficulty: 1,
          assignee_id: a.id,
          assignee_name: 'QA Ana',
          deadline_at: new Date(at - days * 86400000 - 300000).toISOString(),
        })
        .select('id')
        .single(),
    );
    await rows(
      admin
        .from('chore_assignment_events')
        .insert({
          home_id: h,
          instance_id: i.id,
          assignee_id: a.id,
          assignee_name: 'QA Ana',
          reason: 'generated',
          created_at: old,
        }),
    );
    const count = async (c) =>
      (
        await result(
          c
            .from('ratings')
            .select('id', { head: true, count: 'exact' })
            .eq('source_id', i.id)
            .eq('target_user_id', a.id),
        )
      ).count;
    assert.equal(await count(b.c), 0);
    await rpc(a.c, 'leave_home', { target: h });
    assert.equal(
      await count(b.c),
      days,
      'Apply migration 009: leave_home must settle every accrued day before deactivation',
    );
    assert.equal(await count(a.c), 0, 'Departed member must lose RLS read access');
    const membership = await rows(
      b.c
        .from('home_members')
        .select('active,left_at')
        .eq('home_id', h)
        .eq('user_id', a.id)
        .single(),
    );
    assert.equal(membership.active, false);
    assert.ok(membership.left_at);
    const latest = await rows(
      b.c
        .from('ratings')
        .select('overdue_day,effective_at')
        .eq('source_id', i.id)
        .order('overdue_day', { ascending: false })
        .limit(1)
        .single(),
    );
    assert.equal(latest.overdue_day, days);
    assert.ok(Date.parse(latest.effective_at) <= Date.parse(membership.left_at));
    await Promise.all([
      rpc(b.c, 'reconcile_community', { target: h }),
      rpc(b.c, 'reconcile_community', { target: h }),
    ]);
    assert.equal(await count(b.c), days);
    const punishments = await rows(
      b.c
        .from('punishments')
        .select('threshold,severity')
        .eq('home_id', h)
        .eq('user_id', a.id)
        .order('threshold'),
    );
    assert.equal(punishments.length, Math.floor(days / 5));
    if (days >= 5) assert.equal(punishments.filter((x) => x.threshold === 5).length, 1);
    assert.ok(
      (await a.c.rpc('leave_home', { target: h })).error,
      'Repeated leave must not mutate departed membership',
    );
    await rpc(a.c, 'join_home', { invite_code: inv.code });
    const rejoined = await rows(
      a.c
        .from('home_members')
        .select('penalty_active_since')
        .eq('home_id', h)
        .eq('user_id', a.id)
        .single(),
    );
    assert.ok(Date.parse(rejoined.penalty_active_since) >= Date.parse(membership.left_at));
    await rpc(a.c, 'reconcile_community', { target: h });
    assert.equal(await count(b.c), days);
    console.log(
      `PASS ${days} accrued days settled before leaving, ${punishments.length} historical punishments, concurrent reconciliation stable, RLS and reentry epoch intact`,
    );
  }
} finally {
  let failed = false;
  for (const h of homes) {
    const r = await admin.from('homes').delete().eq('id', h);
    if (r.error) {
      failed = true;
      console.error('Fixture home cleanup failed', h, r.error.message);
    }
  }
  for (const u of accounts) {
    const r = await admin.auth.admin.deleteUser(u.id);
    if (r.error) {
      failed = true;
      console.error('Fixture user cleanup failed', u.id, r.error.message);
    }
  }
  console.log('Cleanup limited to this run’s two accounts and fixture homes.');
  if (failed) process.exitCode = 1;
}
