begin;

create table messaging_private.deferred_task_notices (
 instance_id uuid primary key references public.chore_instances(id) on delete cascade,
 event_id uuid not null references public.chore_assignment_events(id) on delete cascade
);
alter table messaging_private.deferred_task_notices enable row level security;
revoke all on messaging_private.deferred_task_notices from public,anon,authenticated,service_role;

create or replace function messaging_private.assignment_notice() returns trigger
language plpgsql security definer set search_path='' as $$
declare starts date;
begin
 if new.reason not in ('generated','reassigned') or new.blocked then return new; end if;
 select i.period_start into starts
 from public.chore_instances i where i.home_id=new.home_id and i.id=new.instance_id
  and i.assignee_id=new.assignee_id and i.completed_at is null and i.cancelled_at is null
  and not i.assignment_blocked;
 if not found then return new; end if;
 if starts>public.home_local_date(new.home_id) then
  insert into messaging_private.deferred_task_notices(instance_id,event_id)
  values(new.instance_id,new.id) on conflict(instance_id) do update set event_id=excluded.event_id;
 else
  delete from messaging_private.deferred_task_notices where instance_id=new.instance_id;
  perform messaging_private.emit_notice(new.home_id,new.assignee_id,'tasks','task_assigned','chore_instances',new.instance_id,new.id::text);
 end if;
 return new;
end $$;

create function messaging_private.deliver_due_task_notices(target uuid,at_time timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare pending record;
begin
 if not exists(select 1 from messaging_private.deferred_task_notices d
  join public.chore_instances i on i.id=d.instance_id and i.home_id=target
  where i.period_start<=public.home_local_date(target,at_time)
   or i.cancelled_at is not null or i.completed_at is not null) then return; end if;
 -- Serialize with reassignment, cancellation and completion. Retry a busy home on the next tick.
 perform 1 from public.homes where id=target for update skip locked;
 if not found then return; end if;
 for pending in
  delete from messaging_private.deferred_task_notices d using public.chore_instances i,public.chore_assignment_events e
  where i.id=d.instance_id and i.home_id=target and e.id=d.event_id
   and (i.period_start<=public.home_local_date(target,at_time)
    or i.cancelled_at is not null or i.completed_at is not null)
  returning d.instance_id,d.event_id,e.assignee_id,
   (i.assignee_id=e.assignee_id and i.completed_at is null and i.cancelled_at is null and not i.assignment_blocked) as valid
 loop
  if pending.valid then
   perform messaging_private.emit_notice(target,pending.assignee_id,'tasks','task_assigned','chore_instances',pending.instance_id,pending.event_id::text);
  end if;
 end loop;
end $$;
revoke all on function messaging_private.deliver_due_task_notices(uuid,timestamptz)
 from public,anon,authenticated,service_role;

-- Reuse the per-home sweep of the existing domain job.
create or replace function messaging_private.remind_home(target uuid,at_time timestamptz) returns integer language plpgsql security definer set search_path='' as $$
declare e record;offset_minutes integer;made integer:=0;
begin
 perform messaging_private.deliver_due_task_notices(target,at_time);
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

commit;
