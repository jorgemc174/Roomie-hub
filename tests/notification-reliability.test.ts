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
