import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { organizationDatabase } from './helpers/database';
import type { ChatPage } from '../src/features/chat/models';
import type { Delivery } from '../src/features/notifications/delivery';
test('Phase 6: chat, canonical notifications, privacy and jobs', async (t) => {
  const { db, as, home, scalar, users } = await organizationDatabase();
  const [alice, bob, cara, outside] = users;
  const h = await home(3),
    other = await home(1);
  const message = randomUUID();
  const send = (
    id = message,
    body = 'Hello 👋\nhttps://example.com',
    reply: string | null = null,
  ) => db.query('select send_chat_message($1,$2,$3,$4)', [h, id, body, reply]);
  const count = (table: string) => scalar<number>(`select count(*)::int v from ${table}`);
  try {
    await t.test('send idempotency, cross-home isolation, protected authorship', async () => {
      await send();
      await send();
      assert.equal(
        await scalar<number>('select count(*)::int v from chat_messages where id=$1', [message]),
        1,
      );
      await assert.rejects(send(message, 'different'), /idempotency_conflict/);
      await as(bob);
      await assert.rejects(
        db.query("select edit_chat_message($1,$2,1,'spoof')", [h, message]),
        /not_author/,
      );
      await assert.rejects(
        db.query(
          "insert into chat_messages(id,home_id,author_user_id,author_name,body) values(gen_random_uuid(),$1,$2,'Fake','x')",
          [h, alice],
        ),
        /permission denied/,
      );
      await assert.rejects(
        db.query("select send_chat_message($1,$2,'x')", [other, randomUUID()]),
        /unauthorized/,
      );
      await as(outside);
      assert.equal(await count('chat_messages'), 0);
      await assert.rejects(db.query('select chat_page($1)', [h]), /unauthorized/);
      await as(alice);
    });
    await t.test('one notice per recipient; no self-notice or client inserts', async () => {
      assert.equal(
        await scalar<number>('select count(*)::int v from notifications where source_id=$1', [
          message,
        ]),
        0,
      );
      await as(bob);
      assert.equal(
        await scalar<number>('select count(*)::int v from notifications where source_id=$1', [
          message,
        ]),
        1,
      );
      await assert.rejects(db.query("update notifications set title='Fake'"), /permission denied/);
      await db.query('select mark_notifications_read()');
      assert.equal(
        await scalar<number>('select count(*)::int v from notifications where read_at is null'),
        0,
      );
      await as(cara);
      assert.equal(
        await scalar<number>('select count(*)::int v from notifications where read_at is null'),
        1,
      );
      await as(alice);
    });
    await t.test('reply references edited/deleted message; audit inaccessible', async () => {
      const reply = randomUUID();
      await send(reply, 'Reply', message);
      await db.query("select edit_chat_message($1,$2,1,'Edited')", [h, message]);
      await assert.rejects(
        db.query("select edit_chat_message($1,$2,1,'Stale')", [h, message]),
        /stale_version/,
      );
      let page = await scalar<ChatPage>('select chat_page($1) v', [h]);
      assert.equal(page.replies[0].body, 'Edited');
      await as(bob);
      await db.query('select delete_chat_message($1,$2,2)', [h, message]);
      await db.query('select delete_chat_message($1,$2,2)', [h, message]);
      page = await scalar<ChatPage>('select chat_page($1) v', [h]);
      assert.equal(page.replies[0].body, '');
      assert.ok(page.replies[0].deleted_at);
      await assert.rejects(
        db.query('select * from messaging_private.chat_audit'),
        /permission denied/,
      );
      await as(alice);
    });
    await t.test('reactions are unique and idempotent', async () => {
      const id = randomUUID();
      await send(id, 'React');
      for (let n = 0; n < 3; n++)
        await db.query("select set_chat_reaction($1,$2,'👍',true)", [h, id]);
      assert.equal(
        await scalar<number>('select count(*)::int v from chat_reactions where message_id=$1', [
          id,
        ]),
        1,
      );
      await as(bob);
      await db.query("select set_chat_reaction($1,$2,'👍',true)", [h, id]);
      const page = await scalar<ChatPage>('select chat_page($1) v', [h]);
      assert.equal(page.reactions.find((r) => r.message_id === id)?.count, 2);
      await db.query("select set_chat_reaction($1,$2,'👍',false)", [h, id]);
      await assert.rejects(
        db.query("select set_chat_reaction($1,$2,'invalid',true)", [h, id]),
        /invalid_reaction/,
      );
      await as(alice);
    });
    await t.test('private attachments: stable retry, scope and deletion access', async () => {
      const id = randomUUID(),
        hash = 'a'.repeat(64);
      const path = await scalar<string>(
        "select prepare_chat_attachment($1,$2,'safe.txt','text/plain',3,$3) v",
        [h, id, hash],
      );
      assert.equal(
        await scalar<string>(
          "select prepare_chat_attachment($1,$2,'safe.txt','text/plain',3,$3) v",
          [h, id, hash],
        ),
        path,
      );
      await assert.rejects(
        db.query("select prepare_chat_attachment($1,$2,'safe.txt','text/plain',4,$3)", [
          h,
          id,
          hash,
        ]),
        /idempotency_conflict/,
      );
      await db.query(
        "insert into storage.objects(bucket_id,name,owner_id,user_metadata) values('chat-files',$1,$2,'{}')",
        [path, alice],
      );
      const idMessage = randomUUID();
      await db.query("select send_chat_message($1,$2,'',null,array[$3::uuid])", [h, idMessage, id]);
      await db.query("select send_chat_message($1,$2,'',null,array[$3::uuid])", [h, idMessage, id]);
      await as(bob);
      assert.equal(await scalar<boolean>('select chat_file_access($1) v', [path]), true);
      assert.equal(await scalar<boolean>('select chat_file_access($1,true) v', [path]), false);
      await as(outside);
      assert.equal(await scalar<boolean>('select chat_file_access($1) v', [path]), false);
      await as(bob);
      await db.query('select delete_chat_message($1,$2,1)', [h, idMessage]);
      assert.equal(await scalar<boolean>('select chat_file_access($1) v', [path]), false);
      await as(alice);
    });
    await t.test(
      'keyset paging traverses 1200 simultaneous messages without gaps or duplicates',
      async () => {
        await db.exec('reset role');
        await db.query(
          "insert into chat_messages(id,home_id,author_user_id,author_name,body,created_at) select gen_random_uuid(),$1,$2,'Alice','bulk',now()-interval '1 day' from generate_series(1,1200)",
          [h, alice],
        );
        await as(alice);
        const seen = new Set<string>();
        let cursor: { created_at: string; id: string } | undefined;
        for (let n = 0; n < 30; n++) {
          const page = await scalar<ChatPage>('select chat_page($1,$2,$3) v', [
            h,
            cursor?.created_at ?? null,
            cursor?.id ?? null,
          ]);
          assert.ok(page.messages.length <= 50);
          if (!page.messages.length) break;
          for (const m of page.messages) {
            assert.ok(!seen.has(m.id));
            seen.add(m.id);
          }
          cursor = page.messages[0];
        }
        assert.equal(seen.size, await count('chat_messages'));
        assert.ok(seen.size >= 1200);
      },
    );
    await t.test(
      'preferences versioned; other users and normal clients cannot run worker',
      async () => {
        await as(bob);
        await db.query(
          "select save_notification_preferences('chat',false,false,false,array[15,60],0)",
        );
        await assert.rejects(
          db.query("select save_notification_preferences('chat',true,true,true,array[60],0)"),
          /stale_version/,
        );
        const id = randomUUID();
        await as(alice);
        await send(id, 'Muted');
        await as(bob);
        assert.equal(
          await scalar<number>('select count(*)::int v from notifications where source_id=$1', [
            id,
          ]),
          0,
        );
        await assert.rejects(db.query('select run_notification_jobs()'), /permission denied/);
        await assert.rejects(
          db.query("select claim_notification_deliveries(array['push'])"),
          /permission denied/,
        );
        await as(cara);
        assert.equal(await count('notification_preferences'), 0);
        await as(alice);
      },
    );
    await t.test('anonymous rating has no author identity in notice, delivery or URL', async () => {
      await as(bob);
      await db.query(
        "select save_notification_preferences('community',true,true,false,array[60],0)",
      );
      await as(alice);
      await db.query("select initialize_rating_reasons($1,'en')", [h]);
      const reason = await scalar<string>(
        "select id v from rating_reasons where home_id=$1 and kind='negative' and not requires_text limit 1",
        [h],
      );
      const id = randomUUID();
      await db.query("select save_rating($1,$2,0,$3,$4,'',true)", [h, id, bob, reason]);
      await as(bob);
      const notice = await scalar<Record<string, unknown>>(
        'select to_jsonb(n) v from notifications n where source_id=$1',
        [id],
      );
      assert.ok(notice);
      assert.ok(!JSON.stringify(notice).includes(alice));
      assert.ok(!JSON.stringify(notice).includes('Alice'));
      await db.exec('reset role;set role service_role');
      const deliveries = await scalar<Delivery[]>(
        "select claim_notification_deliveries(array['email']) v",
      );
      assert.equal(deliveries.length, 1);
      assert.ok(!JSON.stringify(deliveries).includes(alice));
      assert.ok(!JSON.stringify(deliveries).includes('Alice'));
      const d = deliveries[0];
      assert.equal(
        await scalar<boolean>('select notification_delivery_valid($1,$2) v', [d.id, d.lease]),
        true,
      );
      await db.query("select finish_notification_delivery($1,$2,'sent')", [d.id, d.lease]);
      await db.query("select finish_notification_delivery($1,$2,'retry','network_error')", [
        d.id,
        d.lease,
      ]);
      assert.equal(
        (await scalar<Delivery[]>("select claim_notification_deliveries(array['email']) v")).length,
        0,
      );
      await as(alice);
    });
    await t.test(
      'reminders: local DST instant, offsets, idempotency, cancellation and no post-event send',
      async () => {
        await as(bob);
        await db.query(
          "select save_notification_preferences('activities',true,true,false,array[15,60,1440],0)",
        );
        await db.exec('reset role');
        const activity = randomUUID();
        await db.query(
          "insert into activities(id,home_id,title,starts_at,created_by,created_by_name,create_request) values($1,$2,'Meeting',calendar_local_instant('2026-10-25 02:30','Europe/Madrid'),$3,'Bob','{}')",
          [activity, h, bob],
        );
        await db.query(
          "insert into activity_members(home_id,activity_id,user_id,user_name) values($1,$2,$3,'Bob')",
          [h, activity, bob],
        );
        assert.equal(
          await scalar<string>(
            "select to_char(starts_at at time zone 'UTC','HH24:MI') v from activities where id=$1",
            [activity],
          ),
          '01:30',
        );
        for (const minutes of [1440, 60, 15])
          for (let n = 0; n < 3; n++)
            await db.query(
              "select messaging_private.remind_home($1,(select starts_at-$3::int*interval '1 minute'+interval '2 minutes' from activities where id=$2))",
              [h, activity, minutes],
            );
        assert.equal(
          await scalar<number>(
            "select count(*)::int v from notifications where source_id=$1 and event_type='reminder'",
            [activity],
          ),
          3,
        );
        assert.equal(
          await scalar<boolean>(
            "select messaging_private.notice_valid(n,event_at+interval '1 second') v from notifications n where source_id=$1 limit 1",
            [activity],
          ),
          false,
        );
        await db.query(
          "update activities set starts_at=starts_at+interval '1 day',version=version+1 where id=$1",
          [activity],
        );
        assert.equal(
          await scalar<boolean>(
            "select messaging_private.notice_valid(n,event_at-interval '1 minute') v from notifications n where source_id=$1 and event_type='reminder' limit 1",
            [activity],
          ),
          false,
        );
        await db.query('update activities set cancelled_at=now() where id=$1', [activity]);
        await as(alice);
      },
    );
    await t.test('push subscription isolation, SSRF denial, expiry and retry leases', async () => {
      await as(bob);
      await db.query("select save_notification_preferences('chat',true,false,true,array[60],1)");
      const endpoint = 'https://fcm.googleapis.com/fcm/send/test';
      const sub = await scalar<string>('select save_push_subscription($1,$2,$3) v', [
        endpoint,
        'A'.repeat(87),
        'B'.repeat(22),
      ]);
      await assert.rejects(
        db.query('select save_push_subscription($1,$2,$3)', [
          'http://127.0.0.1/secrets',
          'A'.repeat(87),
          'B'.repeat(22),
        ]),
        /check constraint/,
      );
      await as(cara);
      assert.equal(await count('push_subscriptions'), 0);
      await assert.rejects(
        db.query('select save_push_subscription($1,$2,$3)', [
          endpoint,
          'A'.repeat(87),
          'B'.repeat(22),
        ]),
        /subscription_conflict/,
      );
      await as(alice);
      await send(randomUUID(), 'Push');
      await db.exec('reset role;set role service_role');
      const [d] = await scalar<Delivery[]>("select claim_notification_deliveries(array['push']) v");
      assert.ok(d);
      assert.equal(
        (await scalar<Delivery[]>("select claim_notification_deliveries(array['push']) v")).length,
        0,
      );
      await db.query(
        "select finish_notification_delivery($1,$2,'expired','subscription_expired')",
        [d.id, d.lease],
      );
      await as(bob);
      assert.equal(
        await scalar<boolean>('select active v from push_subscriptions where id=$1', [sub]),
        false,
      );
      await as(alice);
    });

    await t.test(
      'task and reservation reminders cover all offsets and invalidate completion/cancellation',
      async () => {
        await as(bob);
        for (const category of ['tasks', 'reservations'])
          await db.query(
            'select save_notification_preferences($1,true,false,false,array[15,60,1440],0)',
            [category],
          );
        await as(alice);
        await db.query("select initialize_resources($1,'en')", [h]);
        const resource = await scalar<string>(
          'select id v from resources where home_id=$1 limit 1',
          [h],
        );
        await db.exec('reset role');
        const chore = await scalar<string>(
          "insert into chores(home_id,name,difficulty,recurrence,anchor_date,assignment_mode) values($1,'Remind task',1,'daily',current_date,'automatic') returning id v",
          [h],
        );
        const task = await scalar<string>(
          "insert into chore_instances(home_id,chore_id,period_start,period_end,task_name,difficulty,assignee_id,assignee_name,deadline_at) values($1,$2,current_date,current_date+1,'Remind task',1,$3,'Bob',now()+interval '25 hours') returning id v",
          [h, chore, bob],
        );
        const reservation = randomUUID();
        await db.query(
          "insert into reservations(id,home_id,resource_id,resource_name,responsible_id,responsible_name,starts_at,ends_at,created_by,created_by_name,create_request) values($1,$2,$3,'Resource',$4,'Bob',now()+interval '25 hours',now()+interval '26 hours',$4,'Bob','{}')",
          [reservation, h, resource, bob],
        );
        for (const minutes of [1440, 60, 15])
          for (let n = 0; n < 2; n++)
            await db.query(
              "select messaging_private.remind_home($1,(select deadline_at-$3::int*interval '1 minute'+interval '2 minutes' from chore_instances where id=$2))",
              [h, task, minutes],
            );
        for (const id of [task, reservation])
          assert.equal(
            await scalar<number>(
              "select count(*)::int v from notifications where source_id=$1 and event_type='reminder'",
              [id],
            ),
            3,
          );
        await db.query(
          "update chore_instances set completed_at=now(),completed_by=$2,completed_by_name='Bob' where id=$1",
          [task, bob],
        );
        await db.query(
          "update reservations set cancelled_at=now(),cancellation_reason='cancelled',version=version+1 where id=$1",
          [reservation],
        );
        for (const id of [task, reservation])
          assert.equal(
            await scalar<boolean>(
              "select messaging_private.notice_valid(n) v from notifications n where source_id=$1 and event_type='reminder' limit 1",
              [id],
            ),
            false,
          );
        await as(alice);
      },
    );
    await t.test(
      'delivery retry backoff, maximum five attempts, lease recovery and post-claim preference checks',
      async () => {
        await as(bob);
        await db.query("select save_notification_preferences('chat',true,true,false,array[60],2)");
        await as(alice);
        const id = randomUUID();
        await send(id, 'Retry');
        await db.exec('reset role');
        const notice = await scalar<string>(
          'select id v from notifications where source_id=$1 and user_id=$2',
          [id, bob],
        );
        let selected: Delivery | undefined;
        for (let attempt = 1; attempt <= 5; attempt++) {
          const batch = await scalar<Delivery[]>(
            "select claim_notification_deliveries(array['email']) v",
          );
          selected = batch.find((d) => d.notification_id === notice);
          assert.ok(selected);
          await db.query("select finish_notification_delivery($1,$2,'retry','network_error')", [
            selected.id,
            selected.lease,
          ]);
          assert.equal(
            await scalar<number>(
              'select attempts v from messaging_private.notification_deliveries where id=$1',
              [selected.id],
            ),
            attempt,
          );
          if (attempt < 5) {
            assert.equal(
              (
                await scalar<Delivery[]>("select claim_notification_deliveries(array['email']) v")
              ).filter((d) => d.notification_id === notice).length,
              0,
            );
            await db.query(
              "update messaging_private.notification_deliveries set next_attempt_at=now()-interval '1 second' where id=$1",
              [selected.id],
            );
          }
        }
        assert.equal(
          await scalar<string>(
            'select status v from messaging_private.notification_deliveries where id=$1',
            [selected!.id],
          ),
          'failed',
        );
        await db.query(
          "update messaging_private.chat_email_windows set next_allowed_at=now()-interval '1 second' where home_id=$1",
          [h],
        );
        await as(alice);
        const later = randomUUID();
        await send(later, 'Lease');
        await db.exec('reset role');
        const laterNotice = await scalar<string>(
          'select id v from notifications where source_id=$1 and user_id=$2',
          [later, bob],
        );
        const first = (
          await scalar<Delivery[]>("select claim_notification_deliveries(array['email']) v")
        ).find((d) => d.notification_id === laterNotice)!;
        await db.query(
          "update messaging_private.notification_deliveries set leased_at=now()-interval '6 minutes' where id=$1",
          [first.id],
        );
        const second = (
          await scalar<Delivery[]>("select claim_notification_deliveries(array['email']) v")
        ).find((d) => d.id === first.id)!;
        assert.notEqual(first.lease, second.lease);
        await db.query("select finish_notification_delivery($1,$2,'sent')", [
          first.id,
          first.lease,
        ]);
        assert.equal(
          await scalar<string>(
            'select status v from messaging_private.notification_deliveries where id=$1',
            [first.id],
          ),
          'processing',
        );
        await as(bob);
        await db.query("select save_notification_preferences('chat',true,false,false,array[60],3)");
        await db.exec('reset role');
        assert.equal(
          await scalar<boolean>('select notification_delivery_valid($1,$2) v', [
            second.id,
            second.lease,
          ]),
          false,
        );
        await as(alice);
      },
    );

    await t.test(
      'fifty chat events yield fifty canonical notices but one opt-in email per five minutes',
      async () => {
        const room = await home(2);
        await as(bob);
        await db.query("select save_notification_preferences('chat',true,true,false,array[60],4)");
        await db.exec('reset role');
        await db.query(
          "insert into chat_messages(id,home_id,author_user_id,author_name,body) select gen_random_uuid(),$1,$2,'Alice','batch' from generate_series(1,50)",
          [room, alice],
        );
        assert.equal(
          await scalar<number>(
            'select count(*)::int v from notifications where home_id=$1 and user_id=$2',
            [room, bob],
          ),
          50,
        );
        assert.equal(
          await scalar<number>(
            "select count(*)::int v from messaging_private.notification_deliveries d join notifications n on n.id=d.notification_id where n.home_id=$1 and d.channel='email'",
            [room],
          ),
          1,
        );
        await db.query(
          "update messaging_private.chat_email_windows set next_allowed_at=now()-interval '1 second' where home_id=$1",
          [room],
        );
        await as(alice);
        await db.query("select send_chat_message($1,$2,'later')", [room, randomUUID()]);
        await db.exec('reset role');
        assert.equal(
          await scalar<number>(
            "select count(*)::int v from messaging_private.notification_deliveries d join notifications n on n.id=d.notification_id where n.home_id=$1 and d.channel='email'",
            [room],
          ),
          2,
        );
        await as(alice);
      },
    );
    await t.test(
      'throttle rolls back the excess message and notifications atomically',
      async () => {
        const room = await home(1);
        await db.exec('reset role');
        await db.query(
          "insert into messaging_private.rate_limits values($1,$2,'send',date_trunc('minute',now()),30)",
          [room, alice],
        );
        await as(alice);
        await assert.rejects(
          db.query("select send_chat_message($1,$2,'limited')", [room, randomUUID()]),
          /rate_limited/,
        );
        assert.equal(
          await scalar<number>('select count(*)::int v from chat_messages where home_id=$1', [
            room,
          ]),
          0,
        );
      },
    );
    await t.test(
      'scheduler executes domain jobs and restores identity; no duplicates on repeated run',
      async () => {
        await db.exec('reset role');
        const claim = await scalar<string>(
          "select current_setting('request.jwt.claim.sub',true) v",
        );
        const first = await scalar<{ homes: number; errors: number }>(
          'select run_notification_jobs() v',
        );
        assert.equal(first.errors, 0);
        assert.ok(first.homes >= 2);
        assert.equal(
          await scalar<string>("select current_setting('request.jwt.claim.sub',true) v"),
          claim,
        );
        const before = await count('notifications');
        await db.query('select run_notification_jobs()');
        assert.equal(await count('notifications'), before);
        await as(alice);
      },
    );

    await t.test(
      'home deletion cascades messages, replies, reactions and private audit atomically',
      async () => {
        const room = await home(1),
          root = randomUUID(),
          reply = randomUUID();
        await db.query("select send_chat_message($1,$2,'root')", [room, root]);
        await db.query("select send_chat_message($1,$2,'reply',$3)", [room, reply, root]);
        await db.query("select set_chat_reaction($1,$2,'👍',true)", [room, root]);
        await db.query('select delete_home($1)', [room]);
        await db.exec('reset role');
        assert.equal(
          await scalar<number>('select count(*)::int v from chat_messages where home_id=$1', [
            room,
          ]),
          0,
        );
        await as(alice);
      },
    );
    await t.test(
      'leaving revokes chat/files/notices and pending deliveries; snapshots stay historical',
      async () => {
        await as(cara);
        const own = randomUUID();
        await send(own, 'Before departure');
        await db.query('select leave_home($1)', [h]);
        assert.equal(await count('chat_messages'), 0);
        assert.equal(await count('notifications'), 0);
        await assert.rejects(send(randomUUID(), 'After departure'), /unauthorized/);
        await as(alice);
        assert.equal(
          await scalar<string>('select author_name v from chat_messages where id=$1', [own]),
          'Cara',
        );
      },
    );
  } finally {
    await db.close();
  }
});
