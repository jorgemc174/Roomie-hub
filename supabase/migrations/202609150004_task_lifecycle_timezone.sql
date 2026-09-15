-- Phase 2 hardening. Never rewrite migrations 001/002/003.
begin;

create function public.valid_home_timezone(zone text) returns boolean
language sql stable set search_path='' as $$
 select zone is not null and (zone='UTC' or position('/' in zone)>0)
 and exists(select 1 from pg_catalog.pg_timezone_names where name=zone);
$$;
-- Existing homes retain their prior UTC calendar; new homes default to Madrid.
alter table public.homes add column timezone text not null default 'UTC';
alter table public.homes alter column timezone set default 'Europe/Madrid';
alter table public.homes add constraint home_timezone_valid check(public.valid_home_timezone(timezone));

create function public.home_local_date(target uuid,at_instant timestamptz default now()) returns date
language sql stable set search_path='' as $$
 select (at_instant at time zone timezone)::date from public.homes where id=target;
$$;

alter table public.chore_instances add column cancelled_at timestamptz;
alter table public.chore_instances add column cancellation_reason text;
alter table public.chore_instances add constraint instance_cancellation_valid check(
 (cancelled_at is null and cancellation_reason is null) or
 (cancelled_at is not null and completed_at is null and cancellation_reason in
 ('horizon_reset','definition_changed','rotation_changed','timezone_changed','membership_changed')));
alter table public.chore_instances drop constraint chore_instances_chore_id_period_start_key;
create unique index chore_instances_live_period on public.chore_instances(chore_id,period_start) where cancelled_at is null;

-- Audit tombstones keep the original UUID, snapshots and assignment events.
-- Internal only: all callers hold the home lock. No client-supplied cutoff is exposed.
create function public.cancel_future_chores(target uuid,task uuid,reason text,cutoff date) returns integer
language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
 update public.chore_instances set cancelled_at=now(),cancellation_reason=reason,assignment_blocked=false,updated_at=now()
 where home_id=target and (task is null or chore_id=task) and period_start>cutoff and completed_at is null and cancelled_at is null;
 get diagnostics affected=row_count;
 return affected;
end $$;

create function public.protect_closed_chore_instance() returns trigger language plpgsql set search_path='' as $$
begin
 if (old.completed_at is not null or old.cancelled_at is not null) and new is distinct from old then
  raise exception 'closed_instance_immutable';
 end if;
 return new;
end $$;
create trigger protect_closed_instance before update on public.chore_instances for each row execute function public.protect_closed_chore_instance();

create function public.invalidate_chore_future() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if row(new.name,new.description,new.difficulty,new.active,new.recurrence,new.interval_count,new.anchor_date,new.assignment_mode,new.deadline_days,new.deadline_time,new.deadline_timezone)
 is distinct from row(old.name,old.description,old.difficulty,old.active,old.recurrence,old.interval_count,old.anchor_date,old.assignment_mode,old.deadline_days,old.deadline_time,old.deadline_timezone) then
  perform 1 from public.homes where id=new.home_id for update;
  perform public.cancel_future_chores(new.home_id,new.id,'definition_changed',public.home_local_date(new.home_id));
 end if;
 return new;
end $$;
create trigger chore_definition_changed after update on public.chores for each row execute function public.invalidate_chore_future();

create function public.invalidate_home_timezone_future() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.timezone is distinct from old.timezone then
  -- Preserve anything that has already started under either calendar at the cutover.
  perform public.cancel_future_chores(new.id,null,'timezone_changed',greatest((now() at time zone old.timezone)::date,(now() at time zone new.timezone)::date));
 end if;
 return new;
end $$;
create trigger home_timezone_changed after update of timezone on public.homes for each row execute function public.invalidate_home_timezone_future();

create function public.invalidate_membership_future() returns trigger language plpgsql security definer set search_path='' as $$
declare task uuid;
begin
 if (tg_op='INSERT' and new.active) or (tg_op='UPDATE' and new.active is distinct from old.active) then
  perform 1 from public.homes where id=new.home_id for update;
  for task in select id from public.chores where home_id=new.home_id and assignment_mode='automatic' loop
   perform public.cancel_future_chores(new.home_id,task,'membership_changed',public.home_local_date(new.home_id));
  end loop;
 end if;
 return new;
end $$;
create trigger membership_future_changed after insert or update of active on public.home_members for each row execute function public.invalidate_membership_future();

create function public.update_home_timezone(target uuid,zone text) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.organization_lock(target);
 if not public.valid_home_timezone(zone) then raise exception 'invalid_timezone'; end if;
 update public.homes set timezone=zone where id=target;
end $$;

create or replace function public.choose_chore_assignee(c public.chores,s date,e date,excluded uuid default null,after_user uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare chosen uuid; last_user uuid; last_pos integer; week_start date; wd integer;
begin
 if c.assignment_mode='manual' then
  last_user:=after_user;
  if last_user is null then
   select assignee_id into last_user from public.chore_instances where chore_id=c.id and cancelled_at is null and period_start<s order by period_start desc limit 1;
  end if;
  select position into last_pos from public.chore_rotation_members where chore_id=c.id and user_id=last_user;
  select r.user_id into chosen from public.chore_rotation_members r
  where r.chore_id=c.id and r.user_id is distinct from excluded and public.chore_eligible(c.home_id,r.user_id,s,e)
  order by case when r.position>coalesce(last_pos,-1) then 0 else 1 end,r.position limit 1;
 else
  select week_starts_on into wd from public.homes where id=c.home_id;
  week_start:=s-((extract(dow from s)::int-wd+7)%7);
  select m.user_id into chosen from public.home_members m
  where m.home_id=c.home_id and m.user_id is distinct from excluded and public.chore_eligible(c.home_id,m.user_id,s,e)
  order by
   (select coalesce(sum(i.difficulty),0) from public.chore_instances i where i.home_id=c.home_id and i.cancelled_at is null and i.assignee_id=m.user_id and i.period_start>=week_start and i.period_start<week_start+7),
   (select coalesce(sum(i.difficulty),0) from public.chore_instances i where i.home_id=c.home_id and i.cancelled_at is null and i.assignee_id=m.user_id),
   md5(c.id::text||s::text||m.user_id::text),m.user_id limit 1;
 end if;
 return chosen;
end $$;

create or replace function public.reconcile_chore_assignments(target uuid) returns integer language plpgsql security definer set search_path='' as $$
declare i public.chore_instances; c public.chores; chosen uuid; nm text; blocked integer:=0;
begin
 perform public.organization_lock(target);
 for i in select * from public.chore_instances where home_id=target and completed_at is null and cancelled_at is null and period_end>public.home_local_date(target) order by period_start,id loop
  if public.chore_eligible(target,i.assignee_id,i.period_start,i.period_end) then
   if i.assignment_blocked then update public.chore_instances set assignment_blocked=false,updated_at=now() where id=i.id; end if;
   continue;
  end if;
  select * into c from public.chores where id=i.chore_id;
  chosen:=public.choose_chore_assignee(c,i.period_start,i.period_end,i.assignee_id,i.assignee_id);
  if chosen is null then
   blocked:=blocked+1;
   if not i.assignment_blocked then update public.chore_instances set assignment_blocked=true,updated_at=now() where id=i.id; end if;
  else
   select name into nm from public.profiles where id=chosen;
   update public.chore_instances set assignee_id=chosen,assignee_name=nm,assignment_blocked=false,updated_at=now() where id=i.id;
   insert into public.chore_assignment_events(home_id,instance_id,assignee_id,assignee_name,reason) values(target,i.id,chosen,nm,'reassigned');
  end if;
 end loop;
 return blocked;
end $$;

create or replace function public.generate_chore_instances(target uuid,from_date date,through_date date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.chores; p record; cursor_date date; chosen uuid; nm text; instance uuid; made integer:=0; blocked integer:=0; work record;
begin
 perform public.organization_lock(target);
 if from_date is null or through_date is null or through_date<from_date or through_date-from_date>366 then raise exception 'invalid_period'; end if;
 blocked:=public.reconcile_chore_assignments(target);
 -- Build candidates then process chronologically, heavier first, stable id last.
 for work in
  select cc.id,pp.period_start,pp.period_end from public.chores cc
  cross join lateral generate_series(from_date::timestamp,through_date::timestamp,interval '1 day') d
  cross join lateral public.chore_period(cc.recurrence,cc.interval_count,cc.anchor_date,d::date) pp
  where cc.home_id=target and cc.active and pp.period_start<=through_date and pp.period_start>=cc.anchor_date
  group by cc.id,cc.difficulty,pp.period_start,pp.period_end order by pp.period_start,cc.difficulty desc,cc.id
 loop
  select * into c from public.chores where id=work.id;
  -- Only live periods block reissue; cancelled rows and their events remain as audit history.
  if exists(select 1 from public.chore_instances where chore_id=c.id and cancelled_at is null and period_start<work.period_end and period_end>work.period_start) then continue; end if;
  chosen:=public.choose_chore_assignee(c,work.period_start,work.period_end);
  if chosen is null then blocked:=blocked+1; continue; end if;
  select name into nm from public.profiles where id=chosen;
  insert into public.chore_instances(home_id,chore_id,period_start,period_end,task_name,difficulty,assignee_id,assignee_name,deadline_at)
  values(target,c.id,work.period_start,work.period_end,c.name,c.difficulty,chosen,nm,
   case when c.deadline_days is null then null else (work.period_start+c.deadline_days+c.deadline_time) at time zone c.deadline_timezone end)
  on conflict(chore_id,period_start) where cancelled_at is null do nothing returning id into instance;
  if instance is not null then
   insert into public.chore_assignment_events(home_id,instance_id,assignee_id,assignee_name,reason) values(target,instance,chosen,nm,'generated'); made:=made+1;
  end if;
 end loop;
 return jsonb_build_object('created',made,'blocked',blocked);
end $$;

create or replace function public.save_chore(target uuid,chore uuid,task_name text,task_description text,weight integer,enabled boolean,
 kind text,every_n integer,anchor date,mode text,rotation uuid[],due_days integer,due_time time,due_timezone text)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; wd integer; normalized date; old_rotation uuid[];
begin
 perform public.organization_lock(target);
 perform * from public.chore_period(kind,every_n,anchor,anchor);
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=due_timezone) then raise exception 'invalid_timezone'; end if;
 if mode='manual' and coalesce(cardinality(rotation),0)=0 then raise exception 'invalid_rotation'; end if;
 if cardinality(rotation)<>(select count(distinct u) from unnest(rotation) u) or exists(
  select 1 from unnest(rotation) u where not exists(select 1 from public.home_members where home_id=target and user_id=u and active)
 ) then raise exception 'invalid_rotation'; end if;
 normalized:=anchor;
 if kind in ('weekly','weeks') then
  select week_starts_on into wd from public.homes where id=target;
  normalized:=anchor-((extract(dow from anchor)::int-wd+7)%7);
 end if;
 if chore is null then
  insert into public.chores(home_id,name,description,difficulty,active,recurrence,interval_count,anchor_date,assignment_mode,deadline_days,deadline_time,deadline_timezone)
  values(target,trim(task_name),task_description,weight,enabled,kind,every_n,normalized,mode,due_days,due_time,due_timezone) returning id into result;
 else
  update public.chores set name=trim(task_name),description=task_description,difficulty=weight,active=enabled,recurrence=kind,interval_count=every_n,
   anchor_date=normalized,assignment_mode=mode,deadline_days=due_days,deadline_time=due_time,deadline_timezone=due_timezone,updated_at=now()
  where id=chore and home_id=target returning id into result;
  if result is null then raise exception 'not_found'; end if;
 end if;
 select coalesce(array_agg(user_id order by position),'{}'::uuid[]) into old_rotation from public.chore_rotation_members where chore_id=result;
 if chore is not null and old_rotation is distinct from (case when mode='manual' then rotation else '{}'::uuid[] end) then
  perform public.cancel_future_chores(target,result,'rotation_changed',public.home_local_date(target));
 end if;
 delete from public.chore_rotation_members where chore_id=result;
 if mode='manual' then
  insert into public.chore_rotation_members(home_id,chore_id,user_id,position) select target,result,u,(ord-1)::int from unnest(rotation) with ordinality a(u,ord);
 end if;
 perform public.reconcile_chore_assignments(target);
 return result;
end $$;

create or replace function public.initialize_chores(target uuid,language_code text default 'es') returns void language plpgsql security definer set search_path='' as $$
declare names text[]; k integer; wd integer; anchor date;
begin
 perform public.organization_lock(target);
 names:=case when language_code='en' then array['Clean kitchen','Clean bathroom','Clean living room','Take out rubbish','Mop floor'] else array['Limpiar cocina','Limpiar baño','Limpiar salón','Sacar basura','Fregar suelo'] end;
 select week_starts_on into wd from public.homes where id=target;
 anchor:=public.home_local_date(target);
 anchor:=anchor-((extract(dow from anchor)::int-wd+7)%7);
 for k in 1..5 loop
  insert into public.chores(home_id,name,difficulty,recurrence,anchor_date,assignment_mode,seed_key)
  values(target,names[k],case when k=4 then 1 else 3 end,'weekly',anchor,'automatic','default-'||k) on conflict(home_id,seed_key) do nothing;
 end loop;
end $$;

create or replace function public.complete_chore(target uuid,instance uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.organization_lock(target);
 if not exists(select 1 from public.chore_instances where home_id=target and id=instance and cancelled_at is null) then raise exception 'not_found'; end if;
 update public.chore_instances set completed_at=now(),completed_by=auth.uid(),completed_by_name=(select name from public.profiles where id=auth.uid()),updated_at=now()
 where home_id=target and id=instance and completed_at is null and cancelled_at is null;
end $$;

-- Normal UI/cron entry point: authoritative home day, current period plus tomorrow only.
create function public.ensure_current_chores(target uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare today date;
begin
 perform public.organization_lock(target);
 today:=public.home_local_date(target);
 return public.generate_chore_instances(target,today,today+1);
end $$;

-- Remove the legacy 30-day backlog without deleting a single assignment event.
do $$ declare h uuid; begin
 for h in select id from public.homes order by id loop
  perform 1 from public.homes where id=h for update;
  perform public.cancel_future_chores(h,null,'horizon_reset',public.home_local_date(h));
 end loop;
end $$;

revoke all on function public.valid_home_timezone(text),public.home_local_date(uuid,timestamptz),public.update_home_timezone(uuid,text),public.ensure_current_chores(uuid) from public,anon;
grant execute on function public.valid_home_timezone(text),public.home_local_date(uuid,timestamptz),public.update_home_timezone(uuid,text),public.ensure_current_chores(uuid) to authenticated;
revoke all on function public.cancel_future_chores(uuid,uuid,text,date),public.protect_closed_chore_instance(),public.invalidate_chore_future(),public.invalidate_home_timezone_future(),public.invalidate_membership_future() from public,anon,authenticated;
-- CREATE OR REPLACE retained the original RPC/helper ACLs from 003.
commit;
