begin;

alter table public.chores
 add column deleted_at timestamptz,
 add column awaiting_assignment boolean not null default false,
 add constraint deleted_chore_inactive check (deleted_at is null or not active);

-- The definition and seed key stay reserved for history. No save or seed can restore it.
create function public.delete_chore(target uuid,task uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.organization_lock(target);
 update public.chores set active=false,deleted_at=now(),updated_at=now()
 where home_id=target and id=task and deleted_at is null;
 if not found then return; end if;
 update public.chore_instances
 set cancelled_at=now(),cancellation_reason='definition_changed',assignment_blocked=false,updated_at=now()
 where home_id=target and chore_id=task and completed_at is null and cancelled_at is null;
 delete from public.chore_rotation_members where home_id=target and chore_id=task;
end $$;

-- Used by regular generation and completion, always under the same home lock.
create function public.issue_chore_period(c public.chores,starts date,ends date) returns text
language plpgsql security definer set search_path='' as $$
declare chosen uuid; nm text; instance uuid;
begin
 if exists(select 1 from public.chore_instances where chore_id=c.id and cancelled_at is null
           and period_start<ends and period_end>starts) then return 'existing'; end if;
 chosen:=public.choose_chore_assignee(c,starts,ends);
 if chosen is null then return 'blocked'; end if;
 select name into nm from public.profiles where id=chosen;
 insert into public.chore_instances(home_id,chore_id,period_start,period_end,task_name,difficulty,assignee_id,assignee_name,deadline_at)
 values(c.home_id,c.id,starts,ends,c.name,c.difficulty,chosen,nm,
  case when c.deadline_days is null then null else (starts+c.deadline_days+c.deadline_time) at time zone c.deadline_timezone end)
 on conflict(chore_id,period_start) where cancelled_at is null do nothing returning id into instance;
 if instance is null then return 'existing'; end if;
 insert into public.chore_assignment_events(home_id,instance_id,assignee_id,assignee_name,reason)
 values(c.home_id,instance,chosen,nm,'generated');
 return 'created';
end $$;

create or replace function public.generate_chore_instances(target uuid,from_date date,through_date date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.chores; made integer:=0; blocked integer:=0; work record;
begin
 perform public.organization_lock(target);
 if from_date is null or through_date is null or through_date<from_date or through_date-from_date>366 then raise exception 'invalid_period'; end if;
 blocked:=public.reconcile_chore_assignments(target);
 -- Build candidates then process chronologically, heavier first, stable id last.
 for work in
  select cc.id,pp.period_start,pp.period_end from public.chores cc
  cross join lateral generate_series(from_date::timestamp,through_date::timestamp,interval '1 day') d
  cross join lateral public.chore_period(cc.recurrence,cc.interval_count,cc.anchor_date,d::date) pp
  where cc.home_id=target and cc.active and not cc.awaiting_assignment and cc.deleted_at is null and pp.period_start<=through_date and pp.period_start>=cc.anchor_date
  group by cc.id,cc.difficulty,pp.period_start,pp.period_end order by pp.period_start,cc.difficulty desc,cc.id
 loop
  select * into c from public.chores where id=work.id;
  case public.issue_chore_period(c,work.period_start,work.period_end)
   when 'created' then made:=made+1;
   when 'blocked' then blocked:=blocked+1;
   else null;
  end case;
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
  update public.chores set name=trim(task_name),description=task_description,difficulty=weight,active=enabled,awaiting_assignment=false,recurrence=kind,interval_count=every_n,
   anchor_date=normalized,assignment_mode=mode,deadline_days=due_days,deadline_time=due_time,deadline_timezone=due_timezone,updated_at=now()
  where id=chore and home_id=target and deleted_at is null returning id into result;
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

create or replace function public.create_home(home_name text, home_currency text default 'EUR') returns uuid
language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
 if auth.uid() is null then raise exception 'unauthorized'; end if;
 insert into public.homes(name,currency) values(trim(home_name),home_currency) returning id into result;
 insert into public.home_members(home_id,user_id) values(result,auth.uid());
 insert into public.invitations(home_id) values(result);
 perform public.initialize_chores(result,(select locale from public.profiles where id=auth.uid()));
 update public.chores set awaiting_assignment=true where home_id=result and seed_key is not null;
 return result;
end; $$;

create or replace function public.complete_chore(target uuid,instance uuid) returns void
language plpgsql security definer set search_path='' as $$
declare i public.chore_instances; c public.chores; p record;
begin
 perform public.organization_lock(target);
 select * into i from public.chore_instances where home_id=target and id=instance and cancelled_at is null;
 if not found then raise exception 'not_found'; end if;
 if i.completed_at is not null then return; end if;
 update public.chore_instances set completed_at=now(),completed_by=auth.uid(),
  completed_by_name=(select name from public.profiles where id=auth.uid()),updated_at=now()
 where home_id=target and id=instance;
 select * into c from public.chores
 where id=i.chore_id and active and not awaiting_assignment and deleted_at is null;
 if not found then return; end if;
 select * into p from public.chore_period(c.recurrence,c.interval_count,c.anchor_date,greatest(i.period_end,c.anchor_date));
 -- An edit may have realigned the calendar since this occurrence was issued.
 if p.period_start<i.period_end then
  select * into p from public.chore_period(c.recurrence,c.interval_count,c.anchor_date,p.period_end);
 end if;
 perform public.issue_chore_period(c,p.period_start,p.period_end);
end $$;

revoke all on function public.issue_chore_period(public.chores,date,date) from public,anon,authenticated;
revoke all on function public.delete_chore(uuid,uuid) from public,anon;
grant execute on function public.delete_chore(uuid,uuid) to authenticated;

commit;
