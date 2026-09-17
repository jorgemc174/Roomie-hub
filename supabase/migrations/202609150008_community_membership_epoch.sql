-- 007 is already applied. Preserve it; close the leave/rejoin backfill edge case additively.
begin;
alter table public.home_members add column penalty_active_since timestamptz;
-- Existing departed users start a fresh eligibility window if they return.
create function community_private.track_membership_epoch() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not old.active and new.active then new.penalty_active_since:=now();end if;
 return new;
end $$;
create trigger community_membership_epoch before update of active on public.home_members for each row execute function community_private.track_membership_epoch();
revoke all on function community_private.track_membership_epoch() from public,anon,authenticated;
create or replace function community_private.issue_overdue(target uuid,cutoff timestamptz,only_instance uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.chore_instances;lastday integer;due integer;k integer;boundary timestamptz;assignment public.chore_assignment_events;made integer:=0;processed integer:=0;decision text;person uuid;
begin
 for i in select * from public.chore_instances where home_id=target and deadline_at is not null and cancelled_at is null and (only_instance is null or id=only_instance) order by deadline_at,id loop
 due:=greatest(0,floor(extract(epoch from (least(cutoff,coalesce(i.completed_at,cutoff))-i.deadline_at))/86400)::integer);
 insert into community_private.penalty_progress(instance_id) values(i.id) on conflict do nothing;
 select last_day into lastday from community_private.penalty_progress where instance_id=i.id;
 for k in (lastday+1)..due loop
 if processed>=500 then return jsonb_build_object('created',made,'processed',processed,'more',true); end if;
 boundary:=i.deadline_at+k*interval '24 hours';
 select * into assignment from public.chore_assignment_events where instance_id=i.id and created_at<=boundary order by created_at desc,event_order desc limit 1;
 if not found then select * into assignment from public.chore_assignment_events where instance_id=i.id order by created_at,event_order limit 1; end if;
 person:=coalesce(assignment.assignee_id,i.assignee_id);
 decision:=case when coalesce(assignment.blocked,i.assignment_blocked) then 'blocked'
 when not exists(select 1 from public.home_members where home_id=target and user_id=person and active and coalesce(penalty_active_since,joined_at)<=boundary) then 'inactive' else 'issued' end;
 insert into community_private.penalty_days(instance_id,day_number,responsible_id,decision) values(i.id,k,person,decision) on conflict do nothing;
 if decision='issued' then
 insert into public.ratings(id,home_id,target_user_id,target_name,kind,initial_kind,reason_name,source,source_id,overdue_day,effective_at)
 values(gen_random_uuid(),target,person,coalesce(assignment.assignee_name,i.assignee_name),'negative','negative',i.task_name,'task_overdue',i.id,k,boundary) on conflict(source_id,overdue_day) do nothing;
 if found then made:=made+1;end if;
 end if;
 update community_private.penalty_progress set last_day=k where instance_id=i.id;processed:=processed+1;
 end loop;
 end loop;
 return jsonb_build_object('created',made,'processed',processed,'more',false);
end $$;
commit;
