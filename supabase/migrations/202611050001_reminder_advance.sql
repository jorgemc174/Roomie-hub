-- PA 1287: generate before the requested threshold, retaining the existing dedupe key.
begin;
create or replace function messaging_private.remind_home(target uuid,at_time timestamptz) returns integer language plpgsql security definer set search_path='' as $$
declare e record;offset_minutes integer;made integer:=0;
begin
 for e in
  select 'tasks' category,'chore_instances' source,id,assignee_id person,deadline_at starts from public.chore_instances where home_id=target and completed_at is null and cancelled_at is null and not assignment_blocked and deadline_at>at_time and deadline_at<=at_time+interval '1 day 2 minutes'
  union all select 'reservations','reservations',id,responsible_id,starts_at from public.reservations where home_id=target and cancelled_at is null and starts_at>at_time and starts_at<=at_time+interval '1 day 2 minutes'
  union all select 'activities','activities',a.id,m.user_id,a.starts_at from public.activities a join public.activity_members m on m.activity_id=a.id and m.attending where a.home_id=target and a.cancelled_at is null and a.starts_at>at_time and a.starts_at<=at_time+interval '1 day 2 minutes'
 loop
  foreach offset_minutes in array coalesce((select reminder_minutes from public.notification_preferences where user_id=e.person and category=e.category),array[60]) loop
   -- Look ahead two minutes to cover generation and the next minute delivery tick.
   -- Never catch up a missed threshold: outages must not send late reminders.
   if e.starts-offset_minutes*interval '1 minute'>=at_time and e.starts-offset_minutes*interval '1 minute'<=at_time+interval '2 minutes' then
    perform messaging_private.emit_notice(target,e.person,e.category,'reminder',e.source,e.id,extract(epoch from e.starts)::text,e.starts,offset_minutes);
    made:=made+1;
   end if;
  end loop;
 end loop;
 update public.notifications n set invalidated_at=at_time where home_id=target and invalidated_at is null and not messaging_private.notice_valid(n,at_time);
 return made;
end $$;


-- Keep inbox notices valid until the event, but never retry external delivery past its threshold.
create or replace function public.claim_notification_deliveries(channels text[],batch_size integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare d messaging_private.notification_deliveries;n public.notifications;p public.notification_preferences;output jsonb:='[]';token uuid;
begin
 for d in select * from messaging_private.notification_deliveries where channel=any(channels) and
 ((status in ('pending','retry') and next_attempt_at<=now()) or (status='processing' and leased_at<now()-interval '5 minutes'))
 order by next_attempt_at,id for update skip locked loop
  exit when jsonb_array_length(output)>=greatest(1,least(coalesce(batch_size,30),30));
  select * into n from public.notifications where id=d.notification_id;
  select * into p from public.notification_preferences where user_id=n.user_id and category=n.category;
  if d.attempts>=5 then update messaging_private.notification_deliveries set status='failed',last_error_code='attempt_limit' where id=d.id;continue;end if;
  if not messaging_private.notice_valid(n) or n.invalidated_at is not null or
    (n.event_type='reminder' and n.event_at-n.reminder_minutes*interval '1 minute'<now()) or
    (d.channel='email' and not coalesce(p.email,false)) or (d.channel='push' and (not coalesce(p.push,false) or not exists(select 1 from public.push_subscriptions where id=d.subscription_id and active))) then
   update messaging_private.notification_deliveries set status='cancelled' where id=d.id;continue;
  end if;
  token:=gen_random_uuid();
  update messaging_private.notification_deliveries set status='processing',attempts=attempts+1,lease=token,leased_at=now() where id=d.id;
  output:=output||jsonb_build_array(jsonb_build_object('id',d.id,'lease',token,'channel',d.channel,'user_id',n.user_id,'notification_id',n.id,'event_at',n.event_at,'title',n.title,'body',n.body,'url',n.target_url,
   'subscription',case when d.channel='push' then (select jsonb_build_object('endpoint',endpoint,'keys',jsonb_build_object('p256dh',p256dh,'auth',auth_key)) from public.push_subscriptions where id=d.subscription_id) else null end));
 end loop;
 return output;
end $$;

create or replace function public.notification_delivery_valid(item uuid,lease_token uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from messaging_private.notification_deliveries d join public.notifications n on n.id=d.notification_id
 join public.notification_preferences p on p.user_id=n.user_id and p.category=n.category
 where d.id=item and d.lease=lease_token and d.status='processing' and n.invalidated_at is null and messaging_private.notice_valid(n)
 and (n.event_type<>'reminder' or n.event_at-n.reminder_minutes*interval '1 minute'>=now())
 and case when d.channel='email' then p.email else p.push and exists(select 1 from public.push_subscriptions where id=d.subscription_id and active) end);
$$;

-- Existing production installations have pg_cron. PGlite has no extensions;
-- scheduler integration tests provide its API and execute these registrations.
do $$ begin
 if to_regnamespace('cron') is not null then
  perform cron.schedule('roomiehub-domain-jobs','* * * * *',$job$select messaging_private.run_jobs();$job$);
  perform cron.schedule('roomiehub-deliveries','* * * * *',$job$select messaging_private.dispatch_deliveries();$job$);
 end if;
end $$;
commit;
