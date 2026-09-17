-- Phase 5 hardening: settle accrued chore penalties before membership is deactivated.
-- 001-008 are applied history and must remain unchanged.
begin;
create or replace function public.leave_home(target uuid) returns void
language plpgsql security definer set search_path='' as $$
declare
 balance numeric;
 departure_at timestamptz;
 report jsonb;
 person uuid;
begin
 perform public.organization_lock(target);
 select b.balance into balance from public.finance_balances(target) b where b.user_id=auth.uid();
 if balance<>0 then raise exception 'outstanding_balance:%',balance; end if;

 -- One logical transaction instant, shared with existing membership/assignment hooks.
 -- Never advance the cutoff between batches; persist exactly this value as left_at.
 departure_at:=now();
 loop
  report:=community_private.issue_overdue(target,departure_at);
  exit when not (report->>'more')::boolean;
  if (report->>'processed')::integer<=0 then raise exception 'overdue_progress_stalled'; end if;
 end loop;
 -- issue_overdue visits the whole home: reconcile every affected active member,
 -- including the departing person while punishments are still eligible to be emitted.
 for person in select user_id from public.home_members where home_id=target and active loop
  perform community_private.reconcile_person(target,person);
 end loop;

 update public.home_members set active=false,left_at=departure_at where home_id=target and user_id=auth.uid();
 perform public.reconcile_departure_chores(target);
 -- Existing triggers still invalidate future work and reconcile calendar departure.
end $$;
revoke all on function public.leave_home(uuid) from public,anon;
grant execute on function public.leave_home(uuid) to authenticated;
commit;
