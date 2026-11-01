-- D2: transition identity, complete reminder coverage and bounded delivery claims.
begin;
-- Assignment history is inserted after the instance update by the domain RPCs.
-- Using its immutable UUID also distinguishes A→B→A within one transaction.
-- Disable (not drop) the old per-instance trigger: same effect, non-destructive.
alter table public.chore_instances disable trigger task_notice;
create function messaging_private.assignment_notice() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.reason in ('generated','reassigned') and not new.blocked and exists(
  select 1 from public.chore_instances i where i.home_id=new.home_id and i.id=new.instance_id
   and i.assignee_id=new.assignee_id and i.completed_at is null and i.cancelled_at is null and not i.assignment_blocked
 ) then
  perform messaging_private.emit_notice(new.home_id,new.assignee_id,'tasks','task_assigned','chore_instances',new.instance_id,new.id::text);
 end if;
 return new;
end $$;
revoke all on function messaging_private.assignment_notice() from public,anon,authenticated,service_role;
create trigger task_notice after insert on public.chore_assignment_events
 for each row execute function messaging_private.assignment_notice();

create or replace function messaging_private.run_jobs() returns jsonb language plpgsql security definer set search_path='' as $$
declare h record;person uuid;old_claim text;run_id bigint;processed integer:=0;errors integer:=0;code text;
begin
 if not pg_try_advisory_xact_lock(620260916) then return jsonb_build_object('busy',true);end if;
 insert into messaging_private.job_runs default values returning id into run_id;
 old_claim:=current_setting('request.jwt.claim.sub',true);
 insert into messaging_private.home_jobs(home_id) select id from public.homes on conflict do nothing;
 for h in select j.home_id from messaging_private.home_jobs j order by j.last_run_at,j.home_id limit 100 loop
  begin
   perform 1 from public.homes where id=h.home_id for update skip locked;
   if not found then continue;end if;
   select user_id into person from public.home_members where home_id=h.home_id and active order by user_id limit 1;
   if person is not null then
    -- Reuse authorized domain RPCs without relaxing their public permission checks.
    perform set_config('request.jwt.claim.sub',person::text,true);
    perform public.ensure_current_chores(h.home_id);
    perform public.reconcile_chore_assignments(h.home_id);
    perform public.generate_recurring_expenses(h.home_id);
    perform public.reconcile_community(h.home_id);
   end if;
   update messaging_private.home_jobs set last_run_at=now() where home_id=h.home_id;
   processed:=processed+1;
  exception when others then
   errors:=errors+1;get stacked diagnostics code=returned_sqlstate;
   update messaging_private.home_jobs set last_run_at=now() where home_id=h.home_id;
  end;
 end loop;
 -- Reminder coverage is independent of the 100-home cap on expensive domain work.
 -- Sweep every home each tick; unique notice keys keep repeated sweeps idempotent.
 for h in select home_id from messaging_private.home_jobs order by home_id loop
  begin
   perform messaging_private.remind_home(h.home_id,now());
  exception when others then
   errors:=errors+1;get stacked diagnostics code=returned_sqlstate;
  end;
 end loop;
 perform set_config('request.jwt.claim.sub',coalesce(old_claim,''),true);
 delete from messaging_private.rate_limits where window_at<now()-interval '1 day';
 delete from messaging_private.job_runs where started_at<now()-interval '30 days';
 update messaging_private.job_runs set finished_at=now(),homes_processed=processed,error_count=errors,last_error_code=code where id=run_id;
 return jsonb_build_object('homes',processed,'errors',errors);
end $$;

create function public.claim_notification_deliveries(channels text[],batch_size integer) returns jsonb language plpgsql security definer set search_path='' as $$
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

-- Preserve the existing one-argument RPC for callers using the original batch size.
create or replace function public.claim_notification_deliveries(channels text[]) returns jsonb
language sql security definer set search_path='' as $$
 select public.claim_notification_deliveries(channels,30);
$$;
revoke all on function public.claim_notification_deliveries(text[],integer) from public,anon,authenticated;
grant execute on function public.claim_notification_deliveries(text[],integer) to service_role;
commit;
