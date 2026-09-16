-- Phase 4, additive. No changes to task or finance generation.
begin;
create extension if not exists btree_gist;
set local search_path=public,extensions;
create table public.resources (
 id uuid primary key,home_id uuid not null references public.homes on delete cascade,
 name text not null check(length(trim(name)) between 1 and 100),description text not null default '' check(length(description)<=2000),
 active boolean not null default true,seed_key text,version integer not null default 1,
 created_by uuid not null references public.profiles,created_by_name text not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(home_id,id),unique(home_id,seed_key)
);
create table public.reservations (
 id uuid primary key,home_id uuid not null references public.homes on delete cascade,resource_id uuid not null,
 resource_name text not null,title text not null default '' check(length(title)<=160),responsible_id uuid not null,responsible_name text not null,
 starts_at timestamptz not null,ends_at timestamptz not null,
 created_by uuid not null references public.profiles,created_by_name text not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 cancelled_at timestamptz,cancellation_reason text,version integer not null default 1,create_request jsonb not null,
 foreign key(home_id,resource_id) references public.resources(home_id,id),
 foreign key(home_id,responsible_id) references public.home_members(home_id,user_id) deferrable initially deferred,
 unique(home_id,id),check(isfinite(starts_at) and isfinite(ends_at) and ends_at>starts_at and ends_at-starts_at<=interval '7 days'),
 check((cancelled_at is null and cancellation_reason is null) or (cancelled_at is not null and cancellation_reason in ('cancelled','member_left'))),
 constraint reservations_no_overlap exclude using gist (resource_id with =,tstzrange(starts_at,ends_at,'[)') with &&) where (cancelled_at is null)
);
create index reservations_home_time on public.reservations(home_id,starts_at,id);
create table public.activities (
 id uuid primary key,home_id uuid not null references public.homes on delete cascade,
 title text not null check(length(trim(title)) between 1 and 160),description text not null default '' check(length(description)<=4000),location text not null default '' check(length(location)<=300),
 starts_at timestamptz not null,ends_at timestamptz,
 created_by uuid not null references public.profiles,created_by_name text not null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),cancelled_at timestamptz,
 version integer not null default 1,create_request jsonb not null,unique(home_id,id),
 check(isfinite(starts_at) and (ends_at is null or (isfinite(ends_at) and ends_at>starts_at)))
);
create index activities_home_time on public.activities(home_id,starts_at,id);
create table public.activity_members (
 home_id uuid not null,activity_id uuid not null,user_id uuid not null,user_name text not null,
 attending boolean not null default true,joined_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 primary key(activity_id,user_id),
 foreign key(home_id,activity_id) references public.activities(home_id,id) on delete cascade,
 foreign key(home_id,user_id) references public.home_members(home_id,user_id) deferrable initially deferred
);
do $$ declare t text;begin
 foreach t in array array['resources','reservations','activities','activity_members'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy member_read on public.%I for select to authenticated using(public.is_home_member(home_id))',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
-- Convert a wall time in the home's zone, not the browser zone. Reject nonexistent DST times.
-- PostgreSQL chooses standard-time interpretation for ambiguous repeated times.
create function public.calendar_local_instant(wall timestamp,zone text) returns timestamptz language plpgsql stable set search_path='' as $$
declare result timestamptz;
begin
 if wall is null or not isfinite(wall) or not public.valid_home_timezone(zone) then raise exception 'invalid_time'; end if;
 result:=wall at time zone zone;
 if result at time zone zone<>wall then raise exception 'nonexistent_local_time'; end if;
 return result;
end $$;
create function public.save_resource(target uuid,item uuid,expected_version integer,label text,notes text,enabled boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.resources;
begin
 perform public.organization_lock(target);
 if item is null or expected_version is null then raise exception 'invalid_resource'; end if;
 select * into r from public.resources where id=item;
 if found then
 if r.home_id<>target then raise exception 'not_found'; end if;
 if expected_version=0 then
 if row(r.name,r.description,r.active) is distinct from row(trim(label),notes,enabled) then raise exception 'idempotency_conflict'; end if;
 return item; end if;
 if r.version<>expected_version then raise exception 'stale_version'; end if;
 update public.resources set name=trim(label),description=notes,active=enabled,version=version+1,updated_at=now() where id=item;
 else
 if expected_version<>0 then raise exception 'not_found'; end if;
 insert into public.resources(id,home_id,name,description,active,created_by,created_by_name) select item,target,trim(label),notes,enabled,auth.uid(),name from public.profiles where id=auth.uid();
 end if;
 return item;
end $$;
create function public.initialize_resources(target uuid,language_code text default 'es') returns void language plpgsql security definer set search_path='' as $$
declare names text[];k integer;
begin
 perform public.organization_lock(target);
 names:=case when language_code='en' then array['Bathroom','Kitchen','Washing machine'] else array['Baño','Cocina','Lavadora'] end;
 for k in 1..3 loop
 insert into public.resources(id,home_id,name,seed_key,created_by,created_by_name) select gen_random_uuid(),target,names[k],'default-'||k,auth.uid(),name from public.profiles where id=auth.uid() on conflict(home_id,seed_key) do nothing;
 end loop;
end $$;
create function public.save_reservation(target uuid,item uuid,expected_version integer,resource uuid,person uuid,label text,start_local timestamp,end_local timestamp,expected_timezone text) returns uuid language plpgsql security definer set search_path='' as $$
declare old public.reservations; zone text;s timestamptz;e timestamptz;rn text;pn text;payload jsonb;conflict public.reservations;
begin
 perform public.organization_lock(target);
 select timezone into zone from public.homes where id=target;
 if zone is distinct from expected_timezone then raise exception 'stale_timezone'; end if;
 if item is null or expected_version is null then raise exception 'invalid_reservation'; end if;
 payload:=jsonb_build_object('resource',resource,'person',person,'label',label,'start',start_local,'end',end_local,'zone',zone);
 select * into old from public.reservations where id=item;
 if found then
 if old.home_id<>target then raise exception 'not_found'; end if;
 if expected_version=0 then
 if old.create_request is distinct from payload then raise exception 'idempotency_conflict'; end if;
 return item;end if;
 if old.version<>expected_version or old.cancelled_at is not null then raise exception 'stale_version'; end if;
 if old.ends_at<=now() then raise exception 'closed_reservation'; end if;
 elsif expected_version<>0 then raise exception 'not_found'; end if;
 select name into rn from public.resources where home_id=target and id=resource and active;
 if not found then raise exception 'resource_unavailable'; end if;
 if not exists(select 1 from public.home_members where home_id=target and user_id=person and active) then raise exception 'invalid_member'; end if;
 select name into pn from public.profiles where id=person;
 -- Preserve original instants when an unchanged wall time is submitted during a DST fold.
 s:=case when old.id is not null and start_local=(old.starts_at at time zone zone) then old.starts_at else public.calendar_local_instant(start_local,zone) end;
 e:=case when old.id is not null and end_local=(old.ends_at at time zone zone) then old.ends_at else public.calendar_local_instant(end_local,zone) end;
 if e<=s or e-s>interval '7 days' then raise exception 'invalid_time'; end if;
 if s<now()-interval '5 minutes' and (old.id is null or s is distinct from old.starts_at) then raise exception 'past_start'; end if;
 select * into conflict from public.reservations where resource_id=resource and cancelled_at is null and id<>item and starts_at<e and ends_at>s order by starts_at limit 1;
 if found then raise exception 'reservation_conflict' using detail=jsonb_build_object('starts_at',conflict.starts_at,'ends_at',conflict.ends_at)::text; end if;
 if old.id is null then
 insert into public.reservations(id,home_id,resource_id,resource_name,title,responsible_id,responsible_name,starts_at,ends_at,created_by,created_by_name,create_request)
 select item,target,resource,rn,label,person,pn,s,e,auth.uid(),name,payload from public.profiles where id=auth.uid();
 else
 update public.reservations set resource_id=resource,resource_name=rn,title=label,responsible_id=person,responsible_name=case when old.responsible_id=person then old.responsible_name else pn end,starts_at=s,ends_at=e,version=version+1,updated_at=now() where id=item;
 end if;
 return item;
end $$;
create function public.cancel_reservation(target uuid,item uuid,expected_version integer) returns void language plpgsql security definer set search_path='' as $$
declare r public.reservations;
begin
 perform public.organization_lock(target);select * into r from public.reservations where home_id=target and id=item;
 if not found then raise exception 'not_found'; end if;
 if r.cancelled_at is not null then return; end if;
 if expected_version is null or r.version<>expected_version then raise exception 'stale_version'; end if;
 update public.reservations set cancelled_at=now(),cancellation_reason='cancelled',version=version+1,updated_at=now() where id=item;
end $$;
create function public.save_activity(target uuid,item uuid,expected_version integer,label text,notes text,place text,start_local timestamp,end_local timestamp,expected_timezone text) returns uuid language plpgsql security definer set search_path='' as $$
declare old public.activities;zone text;s timestamptz;e timestamptz;payload jsonb;nm text;
begin
 perform public.organization_lock(target);select timezone into zone from public.homes where id=target;
 if zone is distinct from expected_timezone then raise exception 'stale_timezone'; end if;
 if item is null or expected_version is null then raise exception 'invalid_activity'; end if;
 payload:=jsonb_build_object('label',label,'notes',notes,'place',place,'start',start_local,'end',end_local,'zone',zone);
 select * into old from public.activities where id=item;
 if found then
 if old.home_id<>target then raise exception 'not_found'; end if;
 if expected_version=0 then
 if old.create_request is distinct from payload then raise exception 'idempotency_conflict'; end if;
 return item;end if;
 if old.version<>expected_version or old.cancelled_at is not null then raise exception 'stale_version'; end if;
 elsif expected_version<>0 then raise exception 'not_found'; end if;
 s:=case when old.id is not null and start_local=(old.starts_at at time zone zone) then old.starts_at else public.calendar_local_instant(start_local,zone) end;
 e:=case when end_local is null then null when old.id is not null and end_local=(old.ends_at at time zone zone) then old.ends_at else public.calendar_local_instant(end_local,zone) end;
 if e is not null and e<=s then raise exception 'invalid_time'; end if;
 if s<now()-interval '5 minutes' and (old.id is null or s is distinct from old.starts_at) then raise exception 'past_start'; end if;
 select name into nm from public.profiles where id=auth.uid();
 if old.id is null then
 insert into public.activities(id,home_id,title,description,location,starts_at,ends_at,created_by,created_by_name,create_request)
 values(item,target,trim(label),notes,place,s,e,auth.uid(),nm,payload);
 insert into public.activity_members(home_id,activity_id,user_id,user_name) values(target,item,auth.uid(),nm);
 else
 update public.activities set title=trim(label),description=notes,location=place,starts_at=s,ends_at=e,updated_at=now(),version=version+1 where id=item;
 end if;
 return item;
end $$;
create function public.cancel_activity(target uuid,item uuid,expected_version integer) returns void language plpgsql security definer set search_path='' as $$
declare a public.activities;
begin
 perform public.organization_lock(target);select * into a from public.activities where home_id=target and id=item;
 if not found then raise exception 'not_found'; end if;
 if a.cancelled_at is not null then return; end if;
 if expected_version is null or a.version<>expected_version then raise exception 'stale_version'; end if;
 update public.activities set cancelled_at=now(),version=version+1,updated_at=now() where id=item;
end $$;
create function public.set_activity_attendance(target uuid,item uuid,joining boolean) returns void language plpgsql security definer set search_path='' as $$
declare a public.activities;
begin
 perform public.organization_lock(target);select * into a from public.activities where home_id=target and id=item and cancelled_at is null;
 if not found then raise exception 'not_found'; end if;
 if coalesce(a.ends_at,a.starts_at)<=now() then raise exception 'closed_activity'; end if;
 if joining is null then raise exception 'invalid_attendance'; end if;
 insert into public.activity_members(home_id,activity_id,user_id,user_name,attending)
 select target,item,auth.uid(),name,joining from public.profiles where id=auth.uid()
 on conflict(activity_id,user_id) do update set attending=excluded.attending,updated_at=now()
 where public.activity_members.attending is distinct from excluded.attending;
end $$;
-- Departure never grants future operational access. Preserve past snapshots.
create function public.calendar_membership_departure() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.active and not new.active then
 update public.reservations set cancelled_at=now(),cancellation_reason='member_left',updated_at=now(),version=version+1
 where home_id=new.home_id and responsible_id=new.user_id and starts_at>now() and cancelled_at is null;
 update public.activity_members m set attending=false,updated_at=now()
 from public.activities a where a.id=m.activity_id and a.home_id=new.home_id and a.starts_at>now() and m.user_id=new.user_id and m.attending;
 end if;
 return new;
end $$;
create trigger calendar_member_left after update of active on public.home_members for each row execute function public.calendar_membership_departure();
revoke all on function public.calendar_membership_departure() from public,anon,authenticated;
revoke all on function public.calendar_local_instant(timestamp,text),public.save_resource(uuid,uuid,integer,text,text,boolean),public.initialize_resources(uuid,text),public.save_reservation(uuid,uuid,integer,uuid,uuid,text,timestamp,timestamp,text),public.cancel_reservation(uuid,uuid,integer),public.save_activity(uuid,uuid,integer,text,text,text,timestamp,timestamp,text),public.cancel_activity(uuid,uuid,integer),public.set_activity_attendance(uuid,uuid,boolean) from public,anon;
grant execute on function public.calendar_local_instant(timestamp,text),public.save_resource(uuid,uuid,integer,text,text,boolean),public.initialize_resources(uuid,text),public.save_reservation(uuid,uuid,integer,uuid,uuid,text,timestamp,timestamp,text),public.cancel_reservation(uuid,uuid,integer),public.save_activity(uuid,uuid,integer,text,text,text,timestamp,timestamp,text),public.cancel_activity(uuid,uuid,integer),public.set_activity_attendance(uuid,uuid,boolean) to authenticated;
alter publication supabase_realtime add table public.resources,public.reservations,public.activities,public.activity_members;
commit;
