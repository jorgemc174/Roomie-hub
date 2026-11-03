begin;
-- Preserve legacy place text without inventing a home/outside classification.
alter table public.activities add column location_kind text
  check (location_kind in ('home','outside'));
alter table public.activities add column participant_request jsonb;
alter table public.activity_members add column response text;
update public.activity_members set response=case when attending then 'going' else 'not_going' end;
alter table public.activity_members alter column response set not null;
alter table public.activity_members add constraint activity_response_valid check (response in ('going','maybe','not_going'));
-- Keep the existing calendar boolean and legacy attendance RPC consistent.
create function public.sync_activity_response() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_OP='INSERT' then
   new.response:=coalesce(new.response,case when new.attending then 'going' else 'not_going' end);
 elsif new.response is not distinct from old.response and new.attending is distinct from old.attending then
   new.response:=case when new.attending then 'going' else 'not_going' end;
 end if;
 new.attending:=(new.response='going');
 return new;
end $$;
create trigger activity_response_sync before insert or update on public.activity_members
 for each row execute function public.sync_activity_response();
revoke all on function public.sync_activity_response() from public,anon,authenticated;

-- Atomic extension of the original time/version/UUID contract. Selected members
-- are initially going; later edits never overwrite another member's response.
create function public.save_activity_plan(target uuid,item uuid,expected_version integer,label text,notes text,place text,start_local timestamp,end_local timestamp,expected_timezone text,kind text,participants uuid[]) returns uuid
language plpgsql security definer set search_path='' as $$
declare old public.activities; selection jsonb; result uuid; person uuid;
begin
 perform public.organization_lock(target);
 if kind is null or kind not in ('home','outside') then raise exception 'invalid_location_kind'; end if;
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
 on conflict(activity_id,user_id) do nothing;
 return result;
end $$;
create function public.respond_activity(target uuid,item uuid,answer text) returns void
language plpgsql security definer set search_path='' as $$
declare a public.activities;
begin
 perform public.organization_lock(target);
 if answer is null or answer not in ('going','maybe','not_going') then raise exception 'invalid_attendance'; end if;
 select * into a from public.activities where home_id=target and id=item and cancelled_at is null;
 if not found then raise exception 'not_found'; end if;
 if coalesce(a.ends_at,a.starts_at)<=now() then raise exception 'closed_activity'; end if;
 insert into public.activity_members(home_id,activity_id,user_id,user_name,response)
 select target,item,auth.uid(),name,answer from public.profiles where id=auth.uid()
 on conflict(activity_id,user_id) do update set response=excluded.response,updated_at=now()
 where public.activity_members.response is distinct from excluded.response;
end $$;
-- Departure must also clear a future "maybe" response (attending=false).
create function public.activity_response_departure() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.active and not new.active then
 update public.activity_members m set response='not_going',updated_at=now()
 from public.activities a where a.id=m.activity_id and a.home_id=new.home_id
 and a.starts_at>now() and m.user_id=new.user_id and m.response<>'not_going';
 end if;
 return new;
end $$;
create trigger activity_response_member_left after update of active on public.home_members
 for each row execute function public.activity_response_departure();
revoke all on function public.activity_response_departure() from public,anon,authenticated;
revoke all on function public.save_activity_plan(uuid,uuid,integer,text,text,text,timestamp,timestamp,text,text,uuid[]), public.respond_activity(uuid,uuid,text) from public,anon;
grant execute on function public.save_activity_plan(uuid,uuid,integer,text,text,text,timestamp,timestamp,text,text,uuid[]), public.respond_activity(uuid,uuid,text) to authenticated;
-- The old signature remains internal to the definer wrapper; clients must choose kind.
revoke execute on function public.save_activity(uuid,uuid,integer,text,text,text,timestamp,timestamp,text) from authenticated;
-- Existing table RLS, read-only grants and home_id Realtime remain in force.
commit;
