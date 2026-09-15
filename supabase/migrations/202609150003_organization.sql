-- Phase 2. All mutations serialize on the home row; no client write grants.
begin;
create table public.chores (
 id uuid primary key default gen_random_uuid(), home_id uuid not null references public.homes on delete cascade,
 name text not null check(char_length(trim(name)) between 1 and 100), description text not null default '' check(char_length(description)<=2000),
 difficulty integer not null check(difficulty between 1 and 5), active boolean not null default true,
 recurrence text not null check(recurrence in ('daily','days','weekly','weeks','monthly')),
 interval_count integer not null default 1 check(interval_count between 1 and 365), anchor_date date not null,
 assignment_mode text not null check(assignment_mode in ('automatic','manual')),
 deadline_days integer check(deadline_days between 0 and 365), deadline_time time not null default '20:00',
 deadline_timezone text not null default 'UTC', seed_key text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(home_id,id), unique(home_id,seed_key),
 check(recurrence in ('days','weeks') or interval_count=1)
);
create table public.chore_rotation_members (
 home_id uuid not null, chore_id uuid not null, user_id uuid not null, position integer not null check(position>=0),
 primary key(chore_id,user_id), unique(chore_id,position),
 foreign key(home_id,chore_id) references public.chores(home_id,id) on delete cascade,
 foreign key(home_id,user_id) references public.home_members(home_id,user_id) on delete no action deferrable initially deferred
);
create table public.absences (
 id uuid primary key default gen_random_uuid(), home_id uuid not null references public.homes on delete cascade,
 user_id uuid not null, user_name text not null, start_date date not null, end_date date not null,
 deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(end_date>=start_date),
 foreign key(home_id,user_id) references public.home_members(home_id,user_id) on delete no action deferrable initially deferred
);
create index absences_dates on public.absences(home_id,user_id,start_date,end_date) where deleted_at is null;
create table public.chore_instances (
 id uuid primary key default gen_random_uuid(), home_id uuid not null references public.homes on delete cascade,
 chore_id uuid not null, period_start date not null, period_end date not null,
 task_name text not null, difficulty integer not null check(difficulty between 1 and 5),
 assignee_id uuid not null, assignee_name text not null, assignment_blocked boolean not null default false,
 generated_at timestamptz not null default now(), deadline_at timestamptz,
 completed_at timestamptz, completed_by uuid references public.profiles on delete restrict, completed_by_name text,
 updated_at timestamptz not null default now(),
 foreign key(home_id,chore_id) references public.chores(home_id,id) on delete cascade,
 foreign key(home_id,assignee_id) references public.home_members(home_id,user_id) on delete no action deferrable initially deferred,
 unique(chore_id,period_start), unique(home_id,id), check(period_end>period_start),
 check((completed_at is null and completed_by is null and completed_by_name is null) or
       (completed_at is not null and completed_by is not null and completed_by_name is not null))
);
create index instances_home_period on public.chore_instances(home_id,period_start,period_end);
create table public.chore_assignment_events (
 id uuid primary key default gen_random_uuid(), home_id uuid not null, instance_id uuid not null,
 assignee_id uuid not null references public.profiles on delete restrict, assignee_name text not null,
 reason text not null check(reason in ('generated','reassigned')), created_at timestamptz not null default now(),
 foreign key(home_id,instance_id) references public.chore_instances(home_id,id) on delete cascade
);
create table public.shopping_lists (
 id uuid primary key default gen_random_uuid(), home_id uuid not null references public.homes on delete cascade,
 name text not null check(char_length(trim(name)) between 1 and 100),
 created_at timestamptz not null default now(), created_by uuid not null references public.profiles on delete restrict,
 created_by_name text not null, completed_at timestamptz, completed_by uuid references public.profiles on delete restrict,
 completed_by_name text, deleted_at timestamptz, updated_at timestamptz not null default now(), unique(home_id,id)
);
create table public.shopping_items (
 id uuid primary key default gen_random_uuid(), home_id uuid not null, shopping_list_id uuid not null,
 name text not null check(char_length(trim(name)) between 1 and 100), purchased boolean not null default false,
 created_at timestamptz not null default now(), created_by uuid not null references public.profiles on delete restrict,
 created_by_name text not null, completed_at timestamptz, completed_by uuid references public.profiles on delete restrict,
 completed_by_name text, deleted_at timestamptz, updated_at timestamptz not null default now(),
 foreign key(home_id,shopping_list_id) references public.shopping_lists(home_id,id) on delete cascade,
 check((purchased and completed_at is not null and completed_by is not null and completed_by_name is not null) or
       (not purchased and completed_at is null and completed_by is null and completed_by_name is null))
);
create index shopping_items_list on public.shopping_items(home_id,shopping_list_id);

-- Reads are home-scoped. Mutations only through checked, transactional RPCs.
do $$ declare t text; begin
 foreach t in array array['chores','chore_rotation_members','absences','chore_instances','chore_assignment_events','shopping_lists','shopping_items'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy member_read on public.%I for select to authenticated using (public.is_home_member(home_id))',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;

create function public.organization_lock(target uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.homes where id=target for update;
 if not found or not public.is_home_member(target) then raise exception 'unauthorized'; end if;
end $$;

-- A home week change realigns future unissued periods. Issued periods are never rewritten.
create function public.realign_chore_weeks() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.week_starts_on is distinct from old.week_starts_on then
  update public.chores set anchor_date=anchor_date-((extract(dow from anchor_date)::int-new.week_starts_on+7)%7),updated_at=now()
  where home_id=new.id and recurrence in ('weekly','weeks');
 end if;
 return new;
end $$;
create trigger organization_week_change after update of week_starts_on on public.homes for each row execute function public.realign_chore_weeks();

-- Pure recurrence function. End is exclusive. Monthly clamps to end of month, without drift.
create function public.chore_period(kind text, n integer, anchor date, on_date date)
returns table(period_start date,period_end date) language plpgsql immutable set search_path='' as $$
declare step integer; idx integer; base date; nxt date; daynum integer;
begin
 if kind not in ('daily','days','weekly','weeks','monthly') or n is null or n<1 or n>365 or anchor is null or on_date is null
 or (kind not in ('days','weeks') and n<>1) then raise exception 'invalid_recurrence'; end if;
 if kind='monthly' then
  daynum:=extract(day from anchor)::int;
  idx:=greatest(0,(extract(year from on_date)::int-extract(year from anchor)::int)*12+extract(month from on_date)::int-extract(month from anchor)::int);
  base:=(date_trunc('month',anchor)+make_interval(months=>idx))::date;
  period_start:=base+least(daynum,extract(day from (base+interval '1 month - 1 day'))::int)-1;
  if period_start>on_date and idx>0 then idx:=idx-1; end if;
  base:=(date_trunc('month',anchor)+make_interval(months=>idx))::date;
  nxt:=(base+interval '1 month')::date;
  period_start:=base+least(daynum,extract(day from (base+interval '1 month - 1 day'))::int)-1;
  period_end:=nxt+least(daynum,extract(day from (nxt+interval '1 month - 1 day'))::int)-1;
 else
  step:=case when kind in ('weekly','weeks') then 7*n else n end;
  idx:=greatest(0,floor((on_date-anchor)::numeric/step)::int);
  period_start:=anchor+idx*step; period_end:=period_start+step;
 end if;
 return next;
end $$;

-- Stable membership/absence eligibility. Any overlap with a period excludes that person.
create function public.chore_eligible(h uuid,u uuid,s date,e date) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.home_members where home_id=h and user_id=u and active)
 and not exists(select 1 from public.absences where home_id=h and user_id=u and deleted_at is null and start_date<e and end_date>=s);
$$;

create function public.choose_chore_assignee(c public.chores,s date,e date,excluded uuid default null,after_user uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare chosen uuid; last_user uuid; last_pos integer; week_start date; wd integer;
begin
 if c.assignment_mode='manual' then
  last_user:=after_user;
  if last_user is null then
   select assignee_id into last_user from public.chore_instances where chore_id=c.id and period_start<s order by period_start desc limit 1;
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
   (select coalesce(sum(i.difficulty),0) from public.chore_instances i where i.home_id=c.home_id and i.assignee_id=m.user_id and i.period_start>=week_start and i.period_start<week_start+7),
   (select coalesce(sum(i.difficulty),0) from public.chore_instances i where i.home_id=c.home_id and i.assignee_id=m.user_id),
   md5(c.id::text||s::text||m.user_id::text),m.user_id limit 1;
 end if;
 return chosen;
end $$;

create function public.reconcile_chore_assignments(target uuid) returns integer language plpgsql security definer set search_path='' as $$
declare i public.chore_instances; c public.chores; chosen uuid; nm text; blocked integer:=0;
begin
 perform public.organization_lock(target);
 for i in select * from public.chore_instances where home_id=target and completed_at is null and period_end>(now() at time zone 'UTC')::date order by period_start,id loop
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

create function public.generate_chore_instances(target uuid,from_date date,through_date date) returns jsonb
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
  -- Previously issued periods are immutable even when a definition's recurrence is edited.
  if exists(select 1 from public.chore_instances where chore_id=c.id and period_start<work.period_end and period_end>work.period_start) then continue; end if;
  chosen:=public.choose_chore_assignee(c,work.period_start,work.period_end);
  if chosen is null then blocked:=blocked+1; continue; end if;
  select name into nm from public.profiles where id=chosen;
  insert into public.chore_instances(home_id,chore_id,period_start,period_end,task_name,difficulty,assignee_id,assignee_name,deadline_at)
  values(target,c.id,work.period_start,work.period_end,c.name,c.difficulty,chosen,nm,
   case when c.deadline_days is null then null else (work.period_start+c.deadline_days+c.deadline_time) at time zone c.deadline_timezone end)
  on conflict(chore_id,period_start) do nothing returning id into instance;
  if instance is not null then
   insert into public.chore_assignment_events(home_id,instance_id,assignee_id,assignee_name,reason) values(target,instance,chosen,nm,'generated'); made:=made+1;
  end if;
 end loop;
 return jsonb_build_object('created',made,'blocked',blocked);
end $$;

create function public.save_chore(target uuid,chore uuid,task_name text,task_description text,weight integer,enabled boolean,
 kind text,every_n integer,anchor date,mode text,rotation uuid[],due_days integer,due_time time,due_timezone text)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; wd integer; normalized date;
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
 delete from public.chore_rotation_members where chore_id=result;
 if mode='manual' then
  insert into public.chore_rotation_members(home_id,chore_id,user_id,position) select target,result,u,(ord-1)::int from unnest(rotation) with ordinality a(u,ord);
 end if;
 perform public.reconcile_chore_assignments(target);
 return result;
end $$;

create function public.initialize_chores(target uuid,language_code text default 'es') returns void language plpgsql security definer set search_path='' as $$
declare names text[]; k integer; wd integer; anchor date;
begin
 perform public.organization_lock(target);
 names:=case when language_code='en' then array['Clean kitchen','Clean bathroom','Clean living room','Take out rubbish','Mop floor'] else array['Limpiar cocina','Limpiar baño','Limpiar salón','Sacar basura','Fregar suelo'] end;
 select week_starts_on into wd from public.homes where id=target;
 anchor:=(now() at time zone 'UTC')::date;
 anchor:=anchor-((extract(dow from anchor)::int-wd+7)%7);
 for k in 1..5 loop
  insert into public.chores(home_id,name,difficulty,recurrence,anchor_date,assignment_mode,seed_key)
  values(target,names[k],case when k=4 then 1 else 3 end,'weekly',anchor,'automatic','default-'||k) on conflict(home_id,seed_key) do nothing;
 end loop;
end $$;

create function public.save_absence(target uuid,absence uuid,person uuid,starts date,ends date,remove boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; nm text;
begin
 perform public.organization_lock(target);
 if remove then
  update public.absences set deleted_at=now(),updated_at=now() where home_id=target and id=absence and deleted_at is null returning id into result;
 else
  if not exists(select 1 from public.home_members where home_id=target and user_id=person and active) then raise exception 'invalid_member'; end if;
  select name into nm from public.profiles where id=person;
  if absence is null then
   insert into public.absences(home_id,user_id,user_name,start_date,end_date) values(target,person,nm,starts,ends) returning id into result;
  else
   update public.absences set user_id=person,user_name=nm,start_date=starts,end_date=ends,updated_at=now()
   where id=absence and home_id=target and deleted_at is null returning id into result;
  end if;
 end if;
 if result is null then raise exception 'not_found'; end if;
 perform public.reconcile_chore_assignments(target);
 return result;
end $$;

create function public.complete_chore(target uuid,instance uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.organization_lock(target);
 if not exists(select 1 from public.chore_instances where home_id=target and id=instance) then raise exception 'not_found'; end if;
 update public.chore_instances set completed_at=now(),completed_by=auth.uid(),completed_by_name=(select name from public.profiles where id=auth.uid()),updated_at=now()
 where home_id=target and id=instance and completed_at is null;
end $$;

-- One list lock domain (the home) for add/toggle/complete: whole-list completion cannot race an add.
create function public.shopping_command(target uuid,operation text,list_id uuid default null,item_id uuid default null,label text default null,checked boolean default true)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; nm text;
begin
 perform public.organization_lock(target);
 select name into nm from public.profiles where id=auth.uid();
 if operation='create_list' then
  insert into public.shopping_lists(home_id,name,created_by,created_by_name) values(target,trim(label),auth.uid(),nm) returning id into result;
  return result;
 end if;
 if not exists(select 1 from public.shopping_lists where home_id=target and id=list_id and deleted_at is null) then raise exception 'not_found'; end if;
 result:=list_id;
 if operation='rename_list' then
  update public.shopping_lists set name=trim(label),updated_at=now() where id=list_id;
 elsif operation='delete_list' then
  update public.shopping_lists set deleted_at=now(),updated_at=now() where id=list_id;
  update public.shopping_items set deleted_at=now(),updated_at=now() where shopping_list_id=list_id and deleted_at is null;
 elsif operation='add_item' then
  insert into public.shopping_items(home_id,shopping_list_id,name,created_by,created_by_name) values(target,list_id,trim(label),auth.uid(),nm) returning id into result;
  update public.shopping_lists set completed_at=null,completed_by=null,completed_by_name=null,updated_at=now() where id=list_id;
 elsif operation in ('toggle_item','delete_item') then
  if not exists(select 1 from public.shopping_items where id=item_id and home_id=target and shopping_list_id=list_id and deleted_at is null) then raise exception 'not_found'; end if;
  if operation='delete_item' then update public.shopping_items set deleted_at=now(),updated_at=now() where id=item_id;
  else
   update public.shopping_items set purchased=checked,completed_at=case when checked then now() end,completed_by=case when checked then auth.uid() end,
    completed_by_name=case when checked then nm end,updated_at=now() where id=item_id and purchased is distinct from checked;
  end if;
 elsif operation='complete_list' then
  update public.shopping_items set purchased=true,completed_at=now(),completed_by=auth.uid(),completed_by_name=nm,updated_at=now()
  where shopping_list_id=list_id and deleted_at is null and not purchased;
 else raise exception 'invalid_operation';
 end if;
 if operation in ('toggle_item','delete_item','complete_list') then
  if exists(select 1 from public.shopping_items where shopping_list_id=list_id and deleted_at is null) and not exists(select 1 from public.shopping_items where shopping_list_id=list_id and deleted_at is null and not purchased) then
   update public.shopping_lists set completed_at=coalesce(completed_at,now()),completed_by=coalesce(completed_by,auth.uid()),completed_by_name=coalesce(completed_by_name,nm),updated_at=now() where id=list_id;
  else update public.shopping_lists set completed_at=null,completed_by=null,completed_by_name=null,updated_at=now() where id=list_id;
  end if;
 end if;
 return result;
end $$;

-- Internal helpers are not callable through the API, including composite-row assignment helper.
revoke all on function public.realign_chore_weeks(),public.organization_lock(uuid),public.chore_eligible(uuid,uuid,date,date),public.choose_chore_assignee(public.chores,date,date,uuid,uuid) from public,anon,authenticated;
revoke all on function public.chore_period(text,integer,date,date),public.reconcile_chore_assignments(uuid),public.generate_chore_instances(uuid,date,date),public.save_chore(uuid,uuid,text,text,integer,boolean,text,integer,date,text,uuid[],integer,time,text),public.initialize_chores(uuid,text),public.save_absence(uuid,uuid,uuid,date,date,boolean),public.complete_chore(uuid,uuid),public.shopping_command(uuid,text,uuid,uuid,text,boolean) from public,anon;
grant execute on function public.chore_period(text,integer,date,date),public.reconcile_chore_assignments(uuid),public.generate_chore_instances(uuid,date,date),public.save_chore(uuid,uuid,text,text,integer,boolean,text,integer,date,text,uuid[],integer,time,text),public.initialize_chores(uuid,text),public.save_absence(uuid,uuid,uuid,date,date,boolean),public.complete_chore(uuid,uuid),public.shopping_command(uuid,text,uuid,uuid,text,boolean) to authenticated;
alter publication supabase_realtime add table public.chores,public.chore_instances,public.absences,public.shopping_lists,public.shopping_items;
commit;
