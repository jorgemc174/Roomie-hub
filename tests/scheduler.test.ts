import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { organizationDatabase } from './helpers/database';
import { serverModule } from './helpers/server-module';

// Keep the general database helper unchanged. Only this suite substitutes the
// unavailable extension entry points; the scheduler SQL and job bodies are real.
async function schedulerDatabase() {
  const context = await organizationDatabase('202609150011_notifications.sql');
  const { db } = context;
  try {
    await db.exec(`
      create schema cron; create schema vault; create schema net;
      create table cron.job(jobid bigint generated always as identity primary key,
        jobname text unique, schedule text, command text);
      create table cron.job_run_details(jobid bigint, end_time timestamptz);
      create function cron.schedule(job_name text, job_schedule text, job_command text)
      returns bigint language sql as $$
        insert into cron.job(jobname,schedule,command) values(job_name,job_schedule,job_command)
        on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command
        returning jobid;
      $$;
      create table vault.decrypted_secrets(name text unique, decrypted_secret text);
      create table net.requests(id bigint generated always as identity, url text,
        headers jsonb, body jsonb, timeout_milliseconds integer);
      create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer)
      returns bigint language sql as $$
        insert into net.requests(url,headers,body,timeout_milliseconds) values($1,$2,$3,$4)
        returning id;
      $$;
    `);
    const scheduler = '202609150012_scheduler.sql';
    const source = await readFile(`supabase/migrations/${scheduler}`, 'utf8');
    const extensions =
      /^create extension if not exists (pg_cron|pg_net|supabase_vault) with schema (pg_catalog|extensions|vault);$/gm;
    assert.equal([...source.matchAll(extensions)].length, 3);
    await db.exec(source.replace(extensions, ''));
    for (const file of (await readdir('supabase/migrations'))
      .filter((file) => file.endsWith('.sql') && file > scheduler)
      .sort())
      await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
    return context;
  } catch (error) {
    await db.close();
    throw error;
  }
}

test('D3: scheduler installation, attachment purge and scheduled job execution', async (t) => {
  const { db, home, as, scalar, users } = await schedulerDatabase();
  try {
    const h = await home(1);
    await db.exec('reset role');
    const jobs = (
      await db.query<{ jobname: string; schedule: string; command: string }>(
        'select jobname,schedule,command from cron.job order by jobname',
      )
    ).rows;
    const command = (name: string) => jobs.find((job) => job.jobname === name)!.command;
    const queued = () => scalar<string[]>('select public.pending_chat_attachment_cleanup() v');
    const count = (table: string) => scalar<number>(`select count(*)::int v from ${table}`);

    await t.test('migration registers the three existing jobs and no extra cron', async () => {
      assert.deepEqual(
        jobs.map(({ jobname, schedule }) => ({ jobname, schedule })),
        [
          { jobname: 'roomiehub-cron-history', schedule: '17 3 * * *' },
          { jobname: 'roomiehub-deliveries', schedule: '*/5 * * * *' },
          { jobname: 'roomiehub-domain-jobs', schedule: '*/5 * * * *' },
        ],
      );
    });

    const ids = Array.from({ length: 5 }, () => randomUUID());
    const paths: string[] = [];
    await as(users[0]);
    for (const [i, id] of ids.entries()) {
      const path = await scalar<string>(
        "select prepare_chat_attachment($1,$2,'file.txt','text/plain',3,repeat('a',64)) v",
        [h, id],
      );
      paths.push(path);
      if (i !== 3)
        await db.query("insert into storage.objects(bucket_id,name) values('chat-files',$1)", [
          path,
        ]);
    }
    await db.query("select send_chat_message($1,$2,'sent',null,array[$3]::uuid[])", [
      h,
      randomUUID(),
      ids[2],
    ]);
    await db.exec('reset role');
    // A similarly named object in another bucket must never be removed.
    await db.query("insert into storage.objects(bucket_id,name) values('avatars',$1)", [paths[0]]);

    await t.test(
      'purge removes only expired pending rows, queues bytes and is idempotent',
      async () => {
        await db.exec('begin');
        await db.query(
          "update chat_attachments set created_at=now()-interval '2 hours' where id=any($1::uuid[])",
          [[ids[0], ids[2], ids[3]]],
        );
        await db.query(
          "update chat_attachments set created_at=now()-interval '1 hour' where id=$1",
          [ids[4]],
        );
        assert.equal(
          await scalar<number>('select messaging_private.purge_expired_chat_attachments() v'),
          3,
        );
        assert.equal(
          await scalar<number>('select messaging_private.purge_expired_chat_attachments() v'),
          0,
        );
        await db.exec('commit');
        assert.deepEqual(
          (await db.query<{ id: string }>('select id from chat_attachments order by id')).rows.map(
            (r) => r.id,
          ),
          [ids[1], ids[2]].sort(),
        );
        assert.deepEqual((await queued()).sort(), [paths[0], paths[3], paths[4]].sort());
        assert.equal(await count('storage.objects'), 5, 'bytes await the Storage API');
        await as(users[0]);
        await assert.rejects(
          db.query("insert into storage.objects(bucket_id,name) values('chat-files',$1)", [
            paths[3],
          ]),
          /row-level security/,
        );
        await db.exec('reset role');
      },
    );

    await t.test(
      'only the worker can read/ack cleanup; no client can purge or dispatch',
      async () => {
        for (const role of ['anon', 'authenticated', 'service_role']) {
          await db.exec(`set role ${role}`);
          for (const query of [
            'select messaging_private.purge_expired_chat_attachments()',
            'select messaging_private.dispatch_deliveries()',
            'select * from messaging_private.chat_attachment_cleanup',
          ])
            await assert.rejects(db.query(query), /permission denied/);
          if (role === 'service_role') assert.equal((await queued()).length, 3);
          else {
            await assert.rejects(queued(), /permission denied/);
            await assert.rejects(
              db.query("select finish_chat_attachment_cleanup('{}')"),
              /permission denied/,
            );
          }
          await db.exec('reset role');
        }
      },
    );

    await t.test(
      'worker retries Storage/ack failures and cleans with email/push disabled',
      async () => {
        let failure: 'storage' | 'ack' | null = 'storage';
        let removals = 0;
        const adapter = {
          rpc: async (name: string, args?: { paths: string[] }) => {
            if (name === 'pending_chat_attachment_cleanup') return { data: await queued() };
            assert.equal(name, 'finish_chat_attachment_cleanup');
            if (failure === 'ack') return { error: { message: 'temporary' } };
            await db.query('select finish_chat_attachment_cleanup($1)', [args!.paths]);
            return {};
          },
          storage: {
            from: (bucket: string) => ({
              remove: async (items: string[]) => {
                assert.equal(bucket, 'chat-files');
                assert.deepEqual([...items].sort(), [paths[0], paths[3], paths[4]].sort());
                removals++;
                if (failure === 'storage') return { error: { message: 'temporary' } };
                // Model the Storage API deleting both its objects and backing bytes.
                await db.exec('reset role');
                await db.query('delete from storage.objects where bucket_id=$1 and name=any($2)', [
                  bucket,
                  items,
                ]);
                await db.exec('set role service_role');
                return {};
              },
            }),
          },
        };
        const { deliverNotifications } = await serverModule<{
          deliverNotifications: () => Promise<{
            disabled: boolean;
            attachmentsRemoved: number;
            attachmentCleanupErrors: number;
          }>;
        }>(
          'src/features/notifications/worker.ts',
          {
            'server-only': {},
            '@supabase/supabase-js': { createClient: () => adapter },
            'web-push': {},
            './delivery': {},
            // The worker reads only these two local configuration values in this test.
          },
          {
            process: {
              env: {
                NEXT_PUBLIC_SUPABASE_URL: 'https://example.test',
                SUPABASE_SECRET_KEY: 'test',
              },
            },
            AbortSignal,
            fetch,
          },
        );
        await db.exec('set role service_role');
        for (const mode of ['storage', 'ack'] as const) {
          failure = mode;
          const result = await deliverNotifications();
          assert.equal(result.disabled, true);
          assert.equal(result.attachmentCleanupErrors, 1);
          assert.equal((await queued()).length, 3);
        }
        failure = null;
        assert.equal((await deliverNotifications()).attachmentsRemoved, 3);
        assert.deepEqual(await queued(), []);
        assert.equal((await deliverNotifications()).attachmentsRemoved, 0);
        assert.equal(removals, 3);
        await db.exec('reset role');
        assert.equal(
          await count('storage.objects'),
          3,
          'recent, sent and other-bucket objects survive',
        );
      },
    );

    await t.test(
      'scheduled domain job purges and generates reminders without duplicates',
      async () => {
        await db.query(
          "update chat_attachments set created_at=now()-interval '2 hours' where id=$1",
          [ids[1]],
        );
        const activity = randomUUID();
        await db.query(
          "insert into activities(id,home_id,title,starts_at,created_by,created_by_name,create_request) values($1,$2,'Reminder',now()+interval '59 minutes',$3,'Alice','{}')",
          [activity, h, users[0]],
        );
        await db.query(
          "insert into activity_members(home_id,activity_id,user_id,user_name) values($1,$2,$3,'Alice')",
          [h, activity, users[0]],
        );
        const run = (
          await db.query<{ run_jobs: { homes: number; errors: number } }>(
            command('roomiehub-domain-jobs'),
          )
        ).rows[0].run_jobs;
        assert.deepEqual(run, { homes: 1, errors: 0 });
        assert.deepEqual(await queued(), [paths[1]]);
        assert.equal(await count('chat_attachments'), 1, 'attached historical file survives');
        const notices = () =>
          scalar<number>(
            "select count(*)::int v from notifications where event_type='reminder' and source_id=$1",
            [activity],
          );
        assert.equal(await notices(), 1);
        await db.exec(command('roomiehub-domain-jobs'));
        assert.equal(await notices(), 1);
        assert.deepEqual(await queued(), [paths[1]]);
        assert.equal(
          await scalar<number>(
            'select count(*)::int v from messaging_private.job_runs where finished_at is not null and error_count=0',
          ),
          2,
        );
      },
    );

    await t.test(
      'scheduled delivery validates Vault configuration and calls HTTP with auth',
      async () => {
        const dispatch = () =>
          db.query<{ dispatch_deliveries: number | null }>(command('roomiehub-deliveries'));
        assert.equal((await dispatch()).rows[0].dispatch_deliveries, null);
        await db.query(
          "insert into vault.decrypted_secrets values('roomiehub_worker_url','https://worker.example.test/api/jobs/notifications')",
        );
        assert.equal((await dispatch()).rows[0].dispatch_deliveries, null);
        await db.query(
          "insert into vault.decrypted_secrets values('roomiehub_worker_token',repeat('x',32))",
        );
        assert.equal((await dispatch()).rows[0].dispatch_deliveries, 1);
        const request = (
          await db.query<{
            url: string;
            headers: Record<string, string>;
            body: unknown;
            timeout_milliseconds: number;
          }>('select url,headers,body,timeout_milliseconds from net.requests')
        ).rows[0];
        assert.equal(request.url, 'https://worker.example.test/api/jobs/notifications');
        assert.equal(request.headers.Authorization, `Bearer ${'x'.repeat(32)}`);
        assert.equal(request.headers['Content-Type'], 'application/json');
        assert.deepEqual(request.body, {});
        assert.equal(request.timeout_milliseconds, 120000);
        for (const url of [
          'http://worker.example.test/api/jobs/notifications',
          'https://worker.example.test/other',
          'https://user@worker.example.test/api/jobs/notifications',
        ]) {
          await db.query(
            "update vault.decrypted_secrets set decrypted_secret=$1 where name='roomiehub_worker_url'",
            [url],
          );
          await assert.rejects(dispatch(), /invalid_worker_configuration/);
        }
        await db.query(
          "update vault.decrypted_secrets set decrypted_secret='https://worker.example.test/api/jobs/notifications' where name='roomiehub_worker_url'",
        );
        await db.query(
          "update vault.decrypted_secrets set decrypted_secret='short' where name='roomiehub_worker_token'",
        );
        await assert.rejects(dispatch(), /invalid_worker_configuration/);
        assert.equal(await count('net.requests'), 1);
      },
    );

    await t.test('scheduled history cleanup removes only old RoomieHub runs', async () => {
      const own = await scalar<number>(
        "select jobid v from cron.job where jobname='roomiehub-domain-jobs'",
      );
      const other = await scalar<number>(
        "select cron.schedule('other-app','* * * * *','select 1') v",
      );
      await db.query(
        "insert into cron.job_run_details values($1,now()-interval '31 days'),($1,now()-interval '1 day'),($1,null),($2,now()-interval '31 days')",
        [own, other],
      );
      await db.exec(command('roomiehub-cron-history'));
      assert.equal(await count('cron.job_run_details'), 3);
      assert.equal(
        await scalar<number>(
          "select count(*)::int v from cron.job_run_details where jobid=$1 and end_time<now()-interval '30 days'",
          [other],
        ),
        1,
      );
      await db.exec(command('roomiehub-cron-history'));
      assert.equal(await count('cron.job_run_details'), 3);
    });
  } finally {
    await db.close();
  }
});
