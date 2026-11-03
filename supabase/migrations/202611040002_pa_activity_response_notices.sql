-- PA 1269: canonical creator notices for explicit attendance transitions.
begin;
create or replace function public.respond_activity(target uuid,item uuid,answer text) returns void
language plpgsql security definer set search_path='' as $$
declare a public.activities; changed integer;
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
 get diagnostics changed=row_count;
 -- Only explicit responses reach this path; participant additions and departure
 -- updates do not. A retry is a no-op; each real transition gets its own UUID,
 -- including A→B→A in one transaction (now()/updated_at cannot identify it).
 if changed>0 and a.created_by<>auth.uid() then
  -- Bound notices per responder; no-op retries consume nothing (same limiter as chat).
  perform messaging_private.throttle(target,'activity_response',10);
  perform messaging_private.emit_notice(target,a.created_by,'activities','activity_changed',
   'activities',item,'response:'||gen_random_uuid()::text);
 end if;
end $$;

create or replace function messaging_private.notice_valid(n public.notifications,at_time timestamptz default now()) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare valid boolean:=false;starts timestamptz;
begin
 if not exists(select 1 from public.home_members where home_id=n.home_id and user_id=n.user_id and active) then return false;end if;
 case n.source_table
 when 'chat_messages' then select deleted_at is null into valid from public.chat_messages where id=n.source_id and home_id=n.home_id;
 when 'ratings' then select deleted_at is null and target_user_id=n.user_id into valid from public.ratings where id=n.source_id and home_id=n.home_id;
 when 'punishments' then select user_id=n.user_id into valid from public.punishments where id=n.source_id and home_id=n.home_id;
 when 'chore_instances' then select completed_at is null and cancelled_at is null and not assignment_blocked and assignee_id=n.user_id,deadline_at into valid,starts from public.chore_instances where id=n.source_id and home_id=n.home_id;
 when 'reservations' then select (cancelled_at is null or n.event_type='reservation_cancelled') and responsible_id=n.user_id,starts_at into valid,starts from public.reservations where id=n.source_id and home_id=n.home_id;
 when 'activities' then
  -- Response notices belong to the creator, even if they declined attendance.
  -- Preserve the validation of all existing activity updates and reminders.
  if n.event_type='activity_changed' and n.source_version like 'response:%' then
   return exists(select 1 from public.activities a where a.id=n.source_id
    and a.home_id=n.home_id and a.created_by=n.user_id and a.cancelled_at is null
    and coalesce(a.ends_at,a.starts_at)>at_time);
  end if;
  select (cancelled_at is null or n.event_type='activity_cancelled') and exists(select 1 from public.activity_members where activity_id=a.id and user_id=n.user_id and attending),starts_at into valid,starts from public.activities a where id=n.source_id and home_id=n.home_id;
 when 'expenses' then select deleted_at is null and (payer=n.user_id or exists(select 1 from public.expense_splits where expense_id=e.id and user_id=n.user_id)) into valid from public.expenses e where id=n.source_id and home_id=n.home_id;
 when 'settlements' then select n.user_id in (from_user,to_user) into valid from public.settlements where id=n.source_id and home_id=n.home_id;
 when 'recurring_expense_instances' then select status='pending' and ((template->>'payer')::uuid=n.user_id or exists(select 1 from jsonb_array_elements(template->'participants') x where (x->>'user_id')::uuid=n.user_id)) into valid from public.recurring_expense_instances where id=n.source_id and home_id=n.home_id;
 else return false;
 end case;
 if n.event_type='reminder' then return coalesce(valid,false) and starts=n.event_at and starts>at_time;end if;
 return coalesce(valid,false);
end $$;

-- Keep the supported legacy attendance endpoint on the same explicit path.
create or replace function public.set_activity_attendance(target uuid,item uuid,joining boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if joining is null then raise exception 'invalid_attendance';end if;
 perform public.respond_activity(target,item,case when joining then 'going' else 'not_going' end);
end $$;

-- CREATE OR REPLACE retains existing ACLs; restate the client boundary explicitly.
revoke all on function public.respond_activity(uuid,uuid,text),public.set_activity_attendance(uuid,uuid,boolean) from public,anon,service_role;
grant execute on function public.respond_activity(uuid,uuid,text),public.set_activity_attendance(uuid,uuid,boolean) to authenticated;
revoke all on function messaging_private.notice_valid(public.notifications,timestamptz) from public,anon,authenticated,service_role;
commit;
