-- Audit B1: preserve overdue boundaries and enforce finance command concurrency/idempotency.
-- Additive replacements only; existing history and function signatures are unchanged.
begin;

create or replace function public.invalidate_chore_future() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if row(new.name,new.description,new.difficulty,new.active,new.recurrence,new.interval_count,new.anchor_date,new.assignment_mode,new.deadline_days,new.deadline_time,new.deadline_timezone)
 is distinct from row(old.name,old.description,old.difficulty,old.active,old.recurrence,old.interval_count,old.anchor_date,old.assignment_mode,old.deadline_days,old.deadline_time,old.deadline_timezone) then
  perform 1 from public.homes where id=new.home_id for update;
  perform public.cancel_future_chores(new.home_id,new.id,'definition_changed',public.home_local_date(new.home_id));
  -- Sync open snapshots, but freeze any deadline that has already been reached.
  -- Moving/removing that boundary would erase accrued days or shift penalty_progress.
  -- Existing penalties and future 24-hour boundaries keep the original absolute instant.
  update public.chore_instances set
   task_name=new.name,
   difficulty=new.difficulty,
   deadline_at=case when deadline_at<=now() then deadline_at
    when new.deadline_days is null then null
    else (period_start+new.deadline_days+new.deadline_time) at time zone new.deadline_timezone end,
   updated_at=now()
  where chore_id=new.id and completed_at is null and cancelled_at is null
   and (task_name,difficulty,deadline_at) is distinct from (new.name,new.difficulty,
    case when deadline_at<=now() then deadline_at
     when new.deadline_days is null then null
     else (period_start+new.deadline_days+new.deadline_time) at time zone new.deadline_timezone end);
 end if;
 return new;
end $$;

create or replace function public.delete_expense(target uuid,item uuid,expected_version integer) returns void language plpgsql security definer set search_path='' as $$
declare e public.expenses;
begin
 perform public.organization_lock(target);
 if expected_version is null then raise exception 'stale_version'; end if;
 select * into e from public.expenses where home_id=target and id=item;
 if not found then raise exception 'not_found'; end if;
 if e.deleted_at is not null then return; end if;
 if e.version<>expected_version then raise exception 'stale_version'; end if;
 update public.expenses set deleted_at=now(),updated_at=now(),version=version+1 where id=item;
 perform public.audit_expense(target,item);
end $$;

create or replace function public.save_recurring_expense(target uuid,item uuid,expected_version integer,body jsonb,recurrence_kind text,freq text,n integer,anchor date,enabled boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare old public.recurring_expenses; person record; total bigint; requested_template jsonb;
begin
 perform public.organization_lock(target);
 if recurrence_kind is null or freq is null or n is null or enabled is null or item is null or anchor is null or anchor<public.home_local_date(target)-3660 or freq not in ('weekly','monthly') or n not between 1 and 120 or recurrence_kind not in ('fixed','variable') or (freq='weekly' and n<>1) or expected_version is null then raise exception 'invalid_recurrence'; end if;
 requested_template:=(body-'shopping_list_id')||case when recurrence_kind='variable' then jsonb_build_object('amount','') else '{}'::jsonb end;
 select * into old from public.recurring_expenses where id=item;
 if found then
  if old.home_id<>target then raise exception 'not_found'; end if;
  if expected_version=0 then
   -- Compare request content only; generation advances next_date/next_index independently.
   if row(old.template,old.kind,old.frequency,old.every_n,old.anchor_date,old.active)
    is distinct from row(requested_template,recurrence_kind,freq,n,anchor,enabled) then
    raise exception 'idempotency_conflict';
   end if;
   return item;
  end if;
  if old.version<>expected_version then raise exception 'stale_version'; end if;
 elsif expected_version<>0 then raise exception 'not_found'; end if;
 if coalesce(length(trim(body->>'title')),0) not between 1 and 160 or body->>'category' is null or body->>'category' not in ('groceries','rent','electricity','water','internet','cleaning','transport','leisure','food','home','subscriptions','other') then raise exception 'invalid_expense'; end if;
 if not exists(select 1 from public.home_members where home_id=target and user_id=(body->>'payer')::uuid and active) then raise exception 'invalid_member'; end if;
 if recurrence_kind='variable' and body->>'split_mode'='custom' then raise exception 'variable_custom_requires_amount'; end if;
 total:=case when recurrence_kind='fixed' then (body->>'amount')::bigint else 10000 end;
 for person in select * from public.money_split(total,body->>'split_mode',body->'participants') loop
 if not exists(select 1 from public.home_members where home_id=target and user_id=person.user_id and active) then raise exception 'invalid_member'; end if;
 end loop;
 if old.id is null then
 insert into public.recurring_expenses(id,home_id,template,kind,frequency,every_n,anchor_date,next_date,active,created_by)
 values(item,target,requested_template,recurrence_kind,freq,n,anchor,anchor,enabled,auth.uid());
 else
 -- Schedule edits only affect unissued periods. Restart anchor must be after last issued date.
 if row(anchor,freq,n) is distinct from row(old.anchor_date,old.frequency,old.every_n) and exists(select 1 from public.recurring_expense_instances where recurring_id=item and period_date>=anchor) then raise exception 'anchor_before_history'; end if;
 update public.recurring_expenses set template=requested_template,kind=recurrence_kind,frequency=freq,every_n=n,anchor_date=anchor,
 next_index=case when row(anchor,freq,n) is distinct from row(old.anchor_date,old.frequency,old.every_n) then 0 else old.next_index end,
 next_date=case when row(anchor,freq,n) is distinct from row(old.anchor_date,old.frequency,old.every_n) then anchor else old.next_date end,
 active=enabled,version=version+1,updated_at=now() where id=item;
 end if;
 return item;
end $$;

revoke all on function public.invalidate_chore_future() from public,anon,authenticated;
revoke all on function public.delete_expense(uuid,uuid,integer),public.save_recurring_expense(uuid,uuid,integer,jsonb,text,text,integer,date,boolean) from public,anon;
grant execute on function public.delete_expense(uuid,uuid,integer),public.save_recurring_expense(uuid,uuid,integer,jsonb,text,text,integer,date,boolean) to authenticated;
commit;
