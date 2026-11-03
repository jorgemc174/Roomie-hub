import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import type { Delivery } from '../src/features/notifications/delivery';

async function moduleWith<T>(
  path: string,
  dependencies: Record<string, unknown>,
  globals: Record<string, unknown>,
) {
  const { outputText } = ts.transpileModule(await readFile(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    crypto,
    AbortSignal,
    fetch,
    require: (name: string) => {
      assert.ok(name in dependencies, `Unexpected import ${name}`);
      return dependencies[name];
    },
    ...globals,
  });
  return exports as T;
}

async function worker(total: number, sendDuration = 0) {
  let clock = 0,
    claims = 0;
  const queue = Array.from({ length: total }, (_, i) => ({
    id: `${i}`,
    lease: `lease-${i}`,
    channel: 'email',
    user_id: 'recipient',
  }));
  const sent = new Set<string>(),
    finished = new Set<string>();
  const db = {
    auth: {
      admin: { getUserById: async () => ({ data: { user: { email: 'test@example.test' } } }) },
    },
    rpc: async (name: string, args: { batch_size?: number; item?: string }) => {
      if (name === 'pending_chat_attachment_cleanup') return { data: [] };
      if (name === 'claim_notification_deliveries') {
        claims++;
        return { data: queue.splice(0, args.batch_size ?? 30) };
      }
      if (name === 'notification_delivery_valid') return { data: true };
      assert.equal(name, 'finish_notification_delivery');
      assert.ok(!finished.has(args.item!));
      finished.add(args.item!);
      return {};
    },
  };
  const { deliverNotifications } = await moduleWith<{
    deliverNotifications: () => Promise<{ claimed: number; sent: number }>;
  }>(
    'src/features/notifications/worker.ts',
    {
      'server-only': {},
      '@supabase/supabase-js': { createClient: () => db },
      'web-push': {},
      './delivery': {
        sendEmail: async (d: Delivery) => {
          assert.ok(!sent.has(d.id));
          sent.add(d.id);
          clock += sendDuration;
          return { outcome: 'sent' };
        },
      },
    },
    {
      process: {
        env: {
          NEXT_PUBLIC_SUPABASE_URL: 'https://example.test',
          SUPABASE_SECRET_KEY: 'test',
          RESEND_API_KEY: 'test',
          ROOMIEHUB_EMAIL_FROM: 'test@example.test',
          NEXT_PUBLIC_SITE_URL: 'https://example.test',
        },
      },
      Date: class extends Date {
        static now() {
          return clock;
        }
      },
    },
  );
  const result = await deliverNotifications();
  return { result, claims, finished, sent, remaining: queue.length, clock };
}

test('D2: worker drains more than 30 deliveries with unique acknowledgements', async () => {
  const { result, claims, finished, remaining } = await worker(75);
  assert.equal(result.claimed, 75);
  assert.equal(result.sent, 75);
  assert.equal(finished.size, 75);
  assert.equal(remaining, 0);
  assert.ok(claims > 1);
});

test('D2: worker stops claiming at its time budget and finishes its small leased batch', async () => {
  const { result, finished, remaining, clock } = await worker(75, 12000);
  assert.ok(result.claimed < 75);
  assert.equal(result.claimed, finished.size);
  assert.equal(result.claimed + remaining, 75);
  assert.ok(clock < 120000);
});

test('D2: bell and inbox share authenticated Realtime with cleanup and late-session protection', async () => {
  for (const lateSession of [false, true]) {
    let effect: (() => void | (() => void)) | undefined;
    let resolveSession!: (v: unknown) => void;
    let changes: (() => void) | undefined, status: ((v: string) => void) | undefined;
    let focus: (() => void) | undefined;
    let removed = 0,
      refreshed = 0,
      authenticated = 0;
    const channel = {
      on: (event: string, filter: Record<string, unknown>, callback: () => void) => {
        assert.equal(event, 'postgres_changes');
        assert.equal(filter.filter, 'user_id=eq.recipient');
        assert.equal(filter.event, '*');
        changes = callback;
        return channel;
      },
      subscribe: (callback: (v: string) => void) => {
        status = callback;
        return channel;
      },
    };
    const db = {
      auth: {
        getSession: () =>
          new Promise((resolve) => {
            resolveSession = resolve;
          }),
      },
      realtime: {
        setAuth: async () => {
          authenticated++;
        },
      },
      channel: () => channel,
      removeChannel: async (value: unknown) => {
        assert.equal(value, channel);
        removed++;
      },
    };
    const { useNoticesRealtime: connectRealtime } = await moduleWith<{
      useNoticesRealtime: (refresh: () => Promise<void>) => void;
    }>(
      'src/features/notifications/realtime.ts',
      {
        react: {
          useEffect: (fn: typeof effect) => {
            effect = fn;
          },
        },
        '@/lib/supabase/browser': { browserClient: () => db },
      },
      {
        window: {
          addEventListener: (name: string, fn: () => void) => {
            assert.equal(name, 'focus');
            focus = fn;
          },
          removeEventListener: (name: string, fn: () => void) => {
            assert.equal(name, 'focus');
            assert.equal(fn, focus);
            focus = undefined;
          },
        },
      },
    );
    connectRealtime(async () => {
      refreshed++;
    });
    const cleanup = effect!() as () => void;
    if (lateSession) cleanup();
    resolveSession({
      data: { session: { access_token: 'test-session', user: { id: 'recipient' } } },
    });
    await new Promise((resolve) => setImmediate(resolve));
    if (lateSession) {
      assert.equal(authenticated, 0);
      assert.equal(refreshed, 0);
      assert.equal(removed, 0);
    } else {
      assert.equal(authenticated, 1);
      const before = refreshed;
      changes!();
      status!('SUBSCRIBED');
      focus!();
      assert.equal(refreshed, before + 3);
      cleanup();
      assert.equal(removed, 1);
      assert.equal(focus, undefined);
      changes!();
      status!('SUBSCRIBED');
      assert.equal(refreshed, before + 3);
    }
  }
  const inbox = await readFile('src/features/notifications/inbox.tsx', 'utf8');
  assert.equal(inbox.match(/useNoticesRealtime\(refresh\)/g)?.length, 2);
});

test('PA 1269: explicit activity responses notify the active creator once per transition', async (t) => {
  const { organizationDatabase } = await import('./helpers/database');
  const { randomUUID } = await import('node:crypto');
  const { db, as, home, scalar, users } = await organizationDatabase();
  const [alice, bob, cara] = users;
  const h = await home(3);
  const id = randomUUID();
  const respond = (answer: string) =>
    db.query('select respond_activity($1,$2,$3)', [h, id, answer]);
  const notices = () =>
    scalar<number>(
      "select count(*)::int v from notifications where source_id=$1 and source_version like 'response:%' and user_id=$2",
      [id, alice],
    );
  const plan = (version: number, participants: string[]) =>
    db.query(
      "select save_activity_plan($1,$2,$3,'Dinner','','Kitchen','2090-09-16 21:00',null,'Europe/Madrid','home',$4::uuid[])",
      [h, id, version, participants],
    );
  try {
    await plan(0, []);
    await t.test('initial response, no-op and A→B→A including one transaction', async () => {
      await as(bob);
      await respond('going');
      await as(alice);
      assert.equal(await notices(), 1);
      await as(bob);
      await respond('going');
      await db.exec('begin');
      await respond('maybe');
      await respond('going');
      await db.exec('commit');
      await respond('going');
      await as(alice);
      assert.equal(await notices(), 3);
      assert.equal(
        await scalar(
          "select count(distinct dedupe_key)::int v from notifications where source_id=$1 and source_version like 'response:%'",
          [id],
        ),
        3,
      );
      assert.equal(
        await scalar(
          "select title v from notifications where source_id=$1 and source_version like 'response:%' limit 1",
          [id],
        ),
        'Actividad actualizada',
      );
      assert.equal(
        await scalar(
          "select target_url v from notifications where source_id=$1 and source_version like 'response:%' limit 1",
          [id],
        ),
        `/homes/${h}/community/activities`,
      );
      await db.exec('reset role');
      assert.equal(
        await scalar('select count(*)::int v from messaging_private.notification_deliveries'),
        0,
      );
    });
    await t.test('creator response, automatic additions and departure are silent', async () => {
      await as(alice);
      await respond('not_going');
      assert.equal(await notices(), 3);
      // Existing notices remain valid even when the creator is not attending.
      await db.exec('reset role');
      assert.equal(
        await scalar(
          "select bool_and(messaging_private.notice_valid(n)) v from notifications n where source_id=$1 and source_version like 'response:%'",
          [id],
        ),
        true,
      );
      await as(alice);
      await plan(1, [cara]);
      // The edit itself emits no notice to the non-attending creator.
      assert.equal(await notices(), 3);
      await as(cara);
      await db.query('select leave_home($1)', [h]);
      await as(alice);
      assert.equal(await notices(), 3);
    });
    await t.test(
      'disabled preferences suppress notices; external channels are opt-in and localized',
      async () => {
        await db.query(
          "select save_notification_preferences('activities',false,false,false,array[60],0)",
        );
        await as(bob);
        await respond('not_going');
        await as(alice);
        assert.equal(await notices(), 3);
        await db.query(
          "select save_notification_preferences('activities',false,true,true,array[60],1)",
        );
        await db.query(
          "select save_push_subscription('https://fcm.googleapis.com/fcm/send/pa1269',$1,$2)",
          ['A'.repeat(87), 'B'.repeat(22)],
        );
        await db.exec('reset role');
        await db.query("update profiles set locale='en' where id=$1", [alice]);
        await as(bob);
        await respond('maybe');
        await respond('maybe');
        await db.exec('reset role');
        assert.equal(await notices(), 4);
        assert.equal(
          await scalar(
            "select count(*)::int v from notifications where source_id=$1 and source_version like 'response:%' and not visible and title='Activity updated'",
            [id],
          ),
          1,
        );
        assert.equal(
          await scalar('select count(*)::int v from messaging_private.notification_deliveries'),
          2,
        );
        const batch = await scalar<Delivery[]>(
          "select claim_notification_deliveries(array['email','push']) v",
        );
        assert.equal(batch.length, 2);
        assert.ok(batch.every((d) => d.url === `/homes/${h}/community/activities`));
        assert.ok(!JSON.stringify(batch).includes(bob));
        assert.ok(!JSON.stringify(batch).includes('Bob'));
      },
    );
    await t.test(
      'legacy attendance shares transition semantics and access stays restricted',
      async () => {
        await as(bob);
        await db.query('select set_activity_attendance($1,$2,false)', [h, id]);
        await db.query('select set_activity_attendance($1,$2,false)', [h, id]);
        await db.exec('reset role');
        assert.equal(await notices(), 5);
        await as(users[3]);
        await assert.rejects(respond('going'), /unauthorized/);
        await as(bob);
        await assert.rejects(
          db.query("update activity_members set response='going' where activity_id=$1", [id]),
          /permission denied/,
        );
        await db.exec('reset role; set role anon');
        await assert.rejects(respond('going'), /permission denied/);
        await as(alice);
        await db.exec('reset role');
        assert.equal(
          await scalar(
            "select has_function_privilege('authenticated','messaging_private.notice_valid(public.notifications,timestamptz)','EXECUTE') v",
          ),
          false,
        );
      },
    );
    await t.test(
      'inactive creator and cancelled or ended activities never notify or deliver',
      async () => {
        await as(alice);
        await db.query('select leave_home($1)', [h]);
        await as(bob);
        await respond('going');
        await db.exec('reset role');
        assert.equal(await notices(), 5);
        assert.equal(
          await scalar(
            "select bool_or(messaging_private.notice_valid(n)) v from notifications n where source_id=$1 and source_version like 'response:%'",
            [id],
          ),
          false,
        );
        await db.query(
          'update home_members set active=true,left_at=null where home_id=$1 and user_id=$2',
          [h, alice],
        );
        await db.query("update activities set starts_at=now()-interval '1 day' where id=$1", [id]);
        await as(bob);
        await assert.rejects(respond('maybe'), /closed_activity/);
        await db.exec('reset role');
        assert.equal(
          await scalar(
            "select bool_or(messaging_private.notice_valid(n)) v from notifications n where source_id=$1 and source_version like 'response:%'",
            [id],
          ),
          false,
        );
        await db.query(
          "update activities set starts_at=now()+interval '1 day',cancelled_at=now() where id=$1",
          [id],
        );
        await as(bob);
        await assert.rejects(respond('maybe'), /not_found/);
        await db.exec('reset role');
        assert.equal(
          await scalar(
            "select bool_or(messaging_private.notice_valid(n)) v from notifications n where source_id=$1 and source_version like 'response:%'",
            [id],
          ),
          false,
        );
      },
    );
  } finally {
    await db.close();
  }
});

test('PA 1269: response changes are rate limited without penalising no-op retries', async () => {
  const { organizationDatabase } = await import('./helpers/database');
  const { randomUUID } = await import('node:crypto');
  const { db, as, home, scalar, users } = await organizationDatabase();
  const [alice, bob] = users;
  const h = await home(2);
  const id = randomUUID();
  const respond = (answer: string) =>
    db.query('select respond_activity($1,$2,$3)', [h, id, answer]);
  try {
    await db.query(
      "select save_activity_plan($1,$2,0,'Dinner','','Kitchen','2090-09-16 21:00',null,'Europe/Madrid','home',$3::uuid[])",
      [h, id, []],
    );
    await as(bob);
    // Freeze now() so the ten transitions share one rate-limit window.
    await db.exec('begin');
    for (let i = 0; i < 10; i++) await respond(i % 2 ? 'going' : 'maybe');
    for (let i = 0; i < 5; i++) await respond('going');
    await db.exec('savepoint limit_reached');
    await assert.rejects(respond('maybe'), /rate_limited/);
    await db.exec('rollback to savepoint limit_reached');
    await db.exec('commit');
    await as(alice);
    assert.equal(
      await scalar<number>(
        "select count(*)::int v from notifications where source_id=$1 and source_version like 'response:%'",
        [id],
      ),
      10,
    );
  } finally {
    await db.close();
  }
});
