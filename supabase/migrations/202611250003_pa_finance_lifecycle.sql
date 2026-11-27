begin;

-- Payments cover the net ledger. A later payment between two contributing
-- parties can have settled any part of this expense, including the entire debt.
create function public.expense_has_settlement(target uuid,item uuid) returns boolean
language sql stable security definer set search_path='' as $$
 with expense as (
  select id,payer,expense_date,created_at from public.expenses
  where home_id=target and id=item and deleted_at is null
 ), parties as (
  select payer as person from expense
  union
  select s.user_id from public.expense_splits s join expense e on s.expense_id=e.id where s.amount>0
 )
 select exists(
  select 1 from public.settlements p join expense e
   on p.home_id=target and p.payment_date>=e.expense_date and p.created_at>=e.created_at
  join parties a on a.person=p.from_user join parties b on b.person=p.to_user
 );
$$;

create function public.settled_expense_ids(target uuid,items uuid[]) returns uuid[]
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_home_member(target) then raise exception 'not_member'; end if;
 if coalesce(cardinality(items),0)>50 then raise exception 'invalid_items'; end if;
 return array(
  select distinct item from unnest(items) item where public.expense_has_settlement(target,item)
 );
end $$;

create or replace function public.save_expense(target uuid,item uuid,expected_version integer,body jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare old public.expenses; person record; nm text; payer_id uuid; payer_nm text; total bigint; mode text; curr text; linked uuid; former_names jsonb;
begin
 perform public.organization_lock(target);
 if item is null or expected_version is null then raise exception 'invalid_expense'; end if;
 select * into old from public.expenses where id=item;
 if found then
  if old.home_id<>target then raise exception 'not_found'; end if;
  if expected_version=0 then
   if old.create_request is distinct from body then raise exception 'idempotency_conflict'; end if;
   return item; end if;
  if old.version<>expected_version or old.deleted_at is not null then raise exception 'stale_version'; end if;
  if public.expense_has_settlement(target,item) then raise exception 'expense_has_settlement'; end if;
 elsif expected_version<>0 then raise exception 'not_found'; end if;
 linked:=nullif(body->>'shopping_list_id','')::uuid;
 if linked is not null then
  if not exists(select 1 from public.shopping_lists where id=linked and home_id=target and completed_at is not null and deleted_at is null) then raise exception 'list_not_complete'; end if;
  if exists(select 1 from public.shopping_list_expense_links where shopping_list_id=linked and expense_id<>item) then raise exception 'list_already_linked'; end if;
 end if;
 if coalesce(body->>'amount','') !~ '^[0-9]{1,13}$' then raise exception 'invalid_amount'; end if;
 total:=(body->>'amount')::bigint; mode:=body->>'split_mode'; payer_id:=(body->>'payer')::uuid;
 if not exists(select 1 from public.home_members where home_id=target and user_id=payer_id and active) and (old.id is null or old.payer is distinct from payer_id) then raise exception 'invalid_member'; end if;
 select name into nm from public.profiles where id=auth.uid();
 select case when old.payer=payer_id then old.payer_name else name end into payer_nm from public.profiles where id=payer_id;
 select currency into curr from public.homes where id=target;
 -- Validate everyone before touching splits. Existing former participants may be retained, never newly added.
 for person in select * from public.money_split(total,mode,body->'participants') loop
  if not exists(select 1 from public.home_members where home_id=target and user_id=person.user_id and active)
   and not exists(select 1 from public.expense_splits where expense_id=item and user_id=person.user_id) then raise exception 'invalid_member'; end if;
 end loop;
 select jsonb_object_agg(user_id::text,user_name) into former_names from public.expense_splits where expense_id=item;
 if old.id is null then
 insert into public.expenses(id,home_id,create_request,title,amount,currency,expense_date,payer,payer_name,category,split_mode,created_by,created_by_name)
 values(item,target,body,trim(body->>'title'),total,curr,(body->>'date')::date,payer_id,payer_nm,body->>'category',mode,auth.uid(),nm);
 else
 update public.expenses set title=trim(body->>'title'),amount=total,expense_date=(body->>'date')::date,payer=payer_id,payer_name=payer_nm,category=body->>'category',split_mode=mode,version=version+1,updated_at=now() where id=item;
 end if;
 delete from public.expense_splits where expense_id=item;
 insert into public.expense_splits(home_id,expense_id,user_id,user_name,amount,weight)
 select target,item,s.user_id,coalesce(former_names->>s.user_id::text,p.name),s.amount,s.weight from public.money_split(total,mode,body->'participants') s join public.profiles p on p.id=s.user_id;
 if linked is not null then insert into public.shopping_list_expense_links values(target,linked,item) on conflict(shopping_list_id) do nothing; end if;
 perform public.audit_expense(target,item);
 return item;
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
 if public.expense_has_settlement(target,item) then raise exception 'expense_has_settlement'; end if;
 update public.expenses set deleted_at=now(),updated_at=now(),version=version+1 where id=item;
 perform public.audit_expense(target,item);
end $$;

create function public.delete_recurring_expense(target uuid,item uuid,expected_version integer) returns void
language plpgsql security definer set search_path='' as $$
declare rule_version integer;
begin
 perform public.organization_lock(target);
 select version into rule_version from public.recurring_expenses where home_id=target and id=item;
 if not found then return; end if;
 if expected_version is distinct from rule_version then raise exception 'stale_version'; end if;
 -- The FK cascades schedule rows only. Posted expenses, splits and revisions are independent.
 delete from public.recurring_expenses where home_id=target and id=item;
 -- Home-scoped Realtime signal, since a deleted rule cannot pass its read policy.
 update public.homes set name=name where id=target;
end $$;

create function public.active_recurring_split(target uuid,template jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare people jsonb; mode text:=template->>'split_mode'; total bigint; denominator numeric;
begin
 if not exists(select 1 from public.home_members where home_id=target and active
               and user_id=(template->>'payer')::uuid) then return null; end if;
 select jsonb_agg(p.value order by p.position) into people
 from jsonb_array_elements(template->'participants') with ordinality p(value,position)
 join public.home_members m on m.home_id=target and m.active and m.user_id=(p.value->>'user_id')::uuid;
 if people is null then return null; end if;
 if mode='equal' or people=template->'participants' then
  return template||jsonb_build_object('participants',people);
 end if;

 select sum((p->>'weight')::numeric) into denominator from jsonb_array_elements(people) p;
 if denominator=0 then
  -- All positive weights belonged to departed members: the remaining members split equally.
  return template||jsonb_build_object('participants',people,'split_mode','equal');
 end if;
 total:=case when mode='custom' then (template->>'amount')::bigint else 10000 end;
 -- Reapportion the original amount or 100% using exact largest remainders.
 with fractions as (
  select (p->>'user_id')::uuid as person,floor(total*(p->>'weight')::numeric/denominator) as units,
         mod(total*(p->>'weight')::numeric,denominator) as remainder
  from jsonb_array_elements(people) p
 ), ranked as (
  select *,row_number() over(order by remainder desc,person) as pos,total-sum(units) over() as extra
  from fractions
 )
 select jsonb_agg(jsonb_build_object('user_id',person,
         'weight',(units+case when pos<=extra then 1 else 0 end)::bigint::text) order by person)
 into people from ranked;
 return template||jsonb_build_object('participants',people);
end $$;

create or replace function public.generate_recurring_expenses(target uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.recurring_expenses; item uuid; expense uuid; due date; idx integer; made integer:=0; payload jsonb;
begin
 perform public.organization_lock(target);
 for r in select * from public.recurring_expenses where home_id=target and active and next_date<=public.home_local_date(target) order by next_date,id loop
 payload:=public.active_recurring_split(target,r.template);
 if payload is null then
  -- No replacement payer or debt is invented. Keep the cursor for a deliberate reactivation.
  update public.recurring_expenses set active=false,version=version+1,updated_at=now() where id=r.id;
  continue;
 end if;
 due:=r.next_date; idx:=r.next_index;
 while due<=public.home_local_date(target) and made<120 loop
 payload:=payload||jsonb_build_object('date',due);
 insert into public.recurring_expense_instances(home_id,recurring_id,period_date,template,recurrence_kind,status)
 values(target,r.id,due,payload,r.kind,'pending') on conflict(recurring_id,period_date) do nothing returning id into item;
 if item is not null and r.kind='fixed' then
  expense:=public.save_expense(target,item,0,payload);
  update public.recurring_expense_instances set status='posted',expense_id=expense,updated_at=now() where id=item;
 end if;
 made:=made+1; idx:=idx+1; due:=public.expense_occurrence(r.anchor_date,r.frequency,r.every_n,idx);
 end loop;
 update public.recurring_expenses set next_index=idx,next_date=due,updated_at=now() where id=r.id;
 end loop;
 return jsonb_build_object('processed',made,'more',exists(select 1 from public.recurring_expenses where home_id=target and active and next_date<=public.home_local_date(target)));
end $$;

revoke all on function public.expense_has_settlement(uuid,uuid),public.active_recurring_split(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.settled_expense_ids(uuid,uuid[]),public.delete_recurring_expense(uuid,uuid,integer) from public,anon;
grant execute on function public.settled_expense_ids(uuid,uuid[]),public.delete_recurring_expense(uuid,uuid,integer) to authenticated;

commit;
