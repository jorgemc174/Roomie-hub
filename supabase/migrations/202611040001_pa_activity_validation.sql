begin;
-- PA 1268: retain locks, immutable creation replay, timezone/DST and versions.
create or replace function public.save_activity(target uuid,item uuid,expected_version integer,label text,notes text,place text,start_local timestamp,end_local timestamp,expected_timezone text) returns uuid language plpgsql security definer set search_path='' as $$
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
 if s<now() and (old.id is null or s is distinct from old.starts_at) then raise exception 'past_start'; end if;
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

create or replace function public.save_activity_plan(target uuid,item uuid,expected_version integer,label text,notes text,place text,start_local timestamp,end_local timestamp,expected_timezone text,kind text,participants uuid[]) returns uuid
language plpgsql security definer set search_path='' as $$
declare old public.activities; selection jsonb; result uuid; person uuid;
begin
 perform public.organization_lock(target);
 if kind is null or kind not in ('home','outside') then raise exception 'invalid_location_kind'; end if;
 if kind='outside' and (place is null or place !~ '[^[:space:]]') then raise exception 'activity_location_required'; end if;
 if participants is null or cardinality(participants)>1000 then raise exception 'invalid_member'; end if;
 select jsonb_build_object('kind',kind,'participants',coalesce(jsonb_agg(p order by p),'[]'::jsonb)) into selection from (select distinct unnest(participants) p) selected;
 select * into old from public.activities where id=item;
 if old.id is not null and old.home_id<>target then raise exception 'not_found'; end if;
 if old.id is not null and expected_version=0 then
   if old.participant_request is distinct from selection then raise exception 'idempotency_conflict'; end if;
   return public.save_activity(target,item,expected_version,label,notes,place,start_local,end_local,expected_timezone);
 end if;
 foreach person in array participants loop
   if person is null or not exists(select 1 from public.home_members where home_id=target and user_id=person and active) then raise exception 'invalid_member'; end if;
 end loop;
 result:=public.save_activity(target,item,expected_version,label,notes,place,start_local,end_local,expected_timezone);
 update public.activities set location_kind=kind,participant_request=case when old.id is null then selection else participant_request end where id=item;
 insert into public.activity_members(home_id,activity_id,user_id,user_name,response)
 select target,item,p.id,p.name,'going' from public.profiles p where p.id=any(participants)
   -- Editing an activity that has already ended must not add retroactive attendees.
   and (old.id is null or exists(select 1 from public.activities a where a.id=item and coalesce(a.ends_at,a.starts_at)>now()))
 on conflict(activity_id,user_id) do nothing;
 return result;
end $$;

-- The legacy function stays internal to the authenticated plan wrapper.
revoke all on function public.save_activity(uuid,uuid,integer,text,text,text,timestamp,timestamp,text) from public,anon,authenticated;
revoke all on function public.save_activity_plan(uuid,uuid,integer,text,text,text,timestamp,timestamp,text,text,uuid[]) from public,anon;
grant execute on function public.save_activity_plan(uuid,uuid,integer,text,text,text,timestamp,timestamp,text,text,uuid[]) to authenticated;
commit;
