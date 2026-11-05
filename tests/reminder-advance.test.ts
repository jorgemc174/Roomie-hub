import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { organizationDatabase } from './helpers/database';

test('PA1287: every offset and source emits only within [T-N-2min,T-N], with dedupe and no outage spam', async () => {
  const { db, home, users, scalar } = await organizationDatabase();
  try {
    const h = await home(1);
    for (const category of ['tasks', 'reservations', 'activities'])
      await db.query(
        'select save_notification_preferences($1,true,true,false,array[15,60,1440],0)',
        [category],
      );
    await db.exec('reset role');
    const activity = randomUUID(),
      reservation = randomUUID(),
      task = randomUUID();
    await db.query(
      "insert into activities(id,home_id,title,starts_at,created_by,created_by_name,create_request) values($1,$2,'Advance',now()+interval '2 days',$3,'Alice','{}')",
      [activity, h, users[0]],
    );
    await db.query(
      "insert into activity_members(home_id,activity_id,user_id,user_name) values($1,$2,$3,'Alice')",
      [h, activity, users[0]],
    );
    const resource = await scalar<string>(
      "insert into resources(id,home_id,name,created_by,created_by_name) values(gen_random_uuid(),$1,'Test resource',$2,'Alice') returning id v",
      [h, users[0]],
    );
    await db.query(
      "insert into reservations(id,home_id,resource_id,resource_name,responsible_id,responsible_name,starts_at,ends_at,created_by,created_by_name,create_request) values($1,$2,$3,'Test resource',$4,'Alice',now()+interval '2 days',now()+interval '2 days 1 hour',$4,'Alice','{}')",
      [reservation, h, resource, users[0]],
    );
    const chore = await scalar<string>(
      "insert into chores(home_id,name,difficulty,recurrence,anchor_date,assignment_mode) values($1,'Advance task',1,'daily',current_date,'automatic') returning id v",
      [h],
    );
    await db.query(
      "insert into chore_instances(id,home_id,chore_id,period_start,period_end,task_name,difficulty,assignee_id,assignee_name,deadline_at) values($1,$2,$3,current_date,current_date+1,'Advance task',1,$4,'Alice',now()+interval '2 days')",
      [task, h, chore, users[0]],
    );
    // Use the same event instant for all three sources.
    const starts = await scalar<string>('select starts_at::text v from activities where id=$1', [
      activity,
    ]);
    await db.query('update reservations set starts_at=$1 where id=$2', [starts, reservation]);
    await db.query('update chore_instances set deadline_at=$1 where id=$2', [starts, task]);
    for (const minutes of [15, 60, 1440]) {
      for (const seconds of [-121, -120, -119, -61, -60, -1, 0, 1, 120, 601, 3600]) {
        await db.exec("delete from notifications where event_type='reminder'");
        const at = await scalar<string>(
          "select ($1::timestamptz-$2::int*interval '1 minute'+$3::int*interval '1 second')::text v",
          [starts, minutes, seconds],
        );
        await db.query('select messaging_private.remind_home($1,$2)', [h, at]);
        const expected = seconds >= -120 && seconds <= 0 ? 3 : 0;
        const count = () =>
          scalar<number>(
            "select count(*)::int v from notifications where event_type='reminder' and reminder_minutes=$1",
            [minutes],
          );
        assert.equal(await count(), expected, `N=${minutes}, seconds=${seconds}`);
        if (expected) {
          assert.equal(
            await scalar<boolean>(
              "select bool_and(messaging_private.notice_valid(n,$1)) v from notifications n where event_type='reminder' and reminder_minutes=$2",
              [at, minutes],
            ),
            true,
          );
          await db.query('select messaging_private.remind_home($1,$2)', [h, at]);
          assert.equal(await count(), 3, 'repeated runs do not duplicate');
        }
      }
    }
    // Inbox validity and external timeliness are separate: suppress missed delivery,
    // even while its source event is still upcoming and valid for the inbox.
    await db.exec("delete from notifications where event_type='reminder'");
    await db.query("update activities set starts_at=now()+interval '14 minutes' where id=$1", [
      activity,
    ]);
    await db.exec('delete from notifications');
    await db.query(
      "select messaging_private.emit_notice($1,$2,'activities','reminder','activities',$3,'late-test',(select starts_at from activities where id=$3),15)",
      [h, users[0], activity],
    );
    assert.equal(
      await scalar<boolean>(
        "select messaging_private.notice_valid(n) v from notifications n where source_version='late-test'",
      ),
      true,
    );
    assert.deepEqual(
      await scalar("select public.claim_notification_deliveries(array['email'],5) v"),
      [],
    );
    assert.equal(
      await scalar(
        "select status v from messaging_private.notification_deliveries d join notifications n on n.id=d.notification_id where source_version='late-test'",
      ),
      'cancelled',
    );
    const lease = randomUUID();
    const delivery = await scalar<string>(
      "update messaging_private.notification_deliveries set status='processing',lease=$1 returning id v",
      [lease],
    );
    assert.equal(
      await scalar('select public.notification_delivery_valid($1,$2) v', [delivery, lease]),
      false,
      'last-moment validation also rejects a late leased reminder',
    );
  } finally {
    await db.close();
  }
});
