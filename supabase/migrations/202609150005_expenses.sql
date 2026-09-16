-- Phase 3: exact, auditable home finances. Previous migrations are immutable.
begin;
create function public.currency_scale(code text) returns integer language sql immutable set search_path='' as $$
 select case when code in ('JPY','KRW','CLP','VND','XAF','XOF','XPF','BIF','DJF','GNF','ISK','KMF','PYG','RWF','UGX','VUV') then 0
 when code in ('BHD','IQD','JOD','KWD','LYD','OMR','TND') then 3 when code in ('CLF','UYW') then 4 else 2 end;
$$;
create table public.expenses (
 id uuid primary key, home_id uuid not null references public.homes on delete cascade,
 create_request jsonb not null, title text not null check(length(trim(title)) between 1 and 160), amount bigint not null check(amount between 1 and 1000000000000),
 currency text not null, expense_date date not null, payer uuid not null, payer_name text not null,
 category text not null check(category in ('groceries','rent','electricity','water','internet','cleaning','transport','leisure','food','home','subscriptions','other')),
 split_mode text not null check(split_mode in ('equal','custom','percentage')), version integer not null default 1,
 created_by uuid not null references public.profiles, created_by_name text not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
 unique(home_id,id), foreign key(home_id,payer) references public.home_members(home_id,user_id) deferrable initially deferred
);
create table public.expense_splits (
 home_id uuid not null, expense_id uuid not null, user_id uuid not null, user_name text not null,
 amount bigint not null check(amount between 0 and 1000000000000), weight bigint not null check(weight>=0),
 primary key(expense_id,user_id), foreign key(home_id,expense_id) references public.expenses(home_id,id) on delete cascade,
 foreign key(home_id,user_id) references public.home_members(home_id,user_id) deferrable initially deferred
);
create table public.expense_events (
 id uuid primary key default gen_random_uuid(), home_id uuid not null, expense_id uuid not null,
 actor uuid not null references public.profiles, actor_name text not null, recorded_at timestamptz not null default now(),
 revision integer not null, snapshot jsonb not null, unique(expense_id,revision),
 foreign key(home_id,expense_id) references public.expenses(home_id,id) on delete cascade
);
create table public.settlements (
 id uuid primary key, home_id uuid not null references public.homes on delete cascade,
 from_user uuid not null, to_user uuid not null, from_name text not null,to_name text not null,
 amount bigint not null check(amount between 1 and 1000000000000), currency text not null, payment_date date not null,
 created_by uuid not null references public.profiles, created_by_name text not null, created_at timestamptz not null default now(),
 check(from_user<>to_user), foreign key(home_id,from_user) references public.home_members(home_id,user_id) deferrable initially deferred,
 foreign key(home_id,to_user) references public.home_members(home_id,user_id) deferrable initially deferred
);
create table public.recurring_expenses (
 id uuid primary key, home_id uuid not null references public.homes on delete cascade,
 template jsonb not null, kind text not null check(kind in ('fixed','variable')),
 frequency text not null check(frequency in ('weekly','monthly')), every_n integer not null check(every_n between 1 and 120),
 anchor_date date not null, next_index integer not null default 0 check(next_index>=0), next_date date not null,
 active boolean not null default true, version integer not null default 1,
 created_by uuid not null references public.profiles, created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(home_id,id),check(frequency<>'weekly' or every_n=1)
);
create table public.recurring_expense_instances (
 id uuid primary key default gen_random_uuid(),home_id uuid not null, recurring_id uuid not null, period_date date not null,
 template jsonb not null, recurrence_kind text not null check(recurrence_kind in ('fixed','variable')), status text not null check(status in ('pending','posted')), expense_id uuid,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(recurring_id,period_date), foreign key(home_id,recurring_id) references public.recurring_expenses(home_id,id) on delete cascade,
 foreign key(home_id,expense_id) references public.expenses(home_id,id),
 check((status='pending' and expense_id is null) or (status='posted' and expense_id is not null))
);
create table public.shopping_list_expense_links (
 home_id uuid not null, shopping_list_id uuid primary key, expense_id uuid not null unique,
 foreign key(home_id,shopping_list_id) references public.shopping_lists(home_id,id) on delete cascade,
 foreign key(home_id,expense_id) references public.expenses(home_id,id) on delete cascade
);
create table public.expense_attachments (
 id uuid primary key default gen_random_uuid(),home_id uuid not null, expense_id uuid not null,
 path text not null unique, mime text not null check(mime in ('image/jpeg','image/png','image/webp','application/pdf')),
 size integer not null check(size between 1 and 10485760),created_at timestamptz not null default now(),
 foreign key(home_id,expense_id) references public.expenses(home_id,id) on delete cascade,
 check(path like home_id::text||'/'||expense_id::text||'/%')
);
create index expenses_home_date on public.expenses(home_id,expense_date desc,id);
create index settlements_home_date on public.settlements(home_id,payment_date desc,id);
create index recurring_home_date on public.recurring_expenses(home_id,next_date) where active;
do $$ declare t text; begin
 foreach t in array array['expenses','expense_splits','expense_events','settlements','recurring_expenses','recurring_expense_instances','shopping_list_expense_links','expense_attachments'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy member_read on public.%I for select to authenticated using(public.is_home_member(home_id))',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
-- No floating point: integer weights; largest remainder, ties by UUID ascending.
create function public.money_split(total bigint, mode text, people jsonb)
returns table(user_id uuid,amount bigint,weight bigint) language plpgsql immutable set search_path='' as $$
declare denom numeric; n integer;
begin
 if total is null or total<1 or total>1000000000000 or mode is null or mode not in ('equal','custom','percentage') or jsonb_typeof(people) is distinct from 'array' then raise exception 'invalid_split'; end if;
 n:=jsonb_array_length(people);
 if n<1 or n>100 or (select count(distinct (x->>'user_id')::uuid) from jsonb_array_elements(people) x)<>n
 or exists(select 1 from jsonb_array_elements(people) x where x->>'user_id' is null or (mode<>'equal' and coalesce(x->>'weight','') !~ '^[0-9]{1,13}$')) then raise exception 'invalid_split'; end if;
 select sum(case when mode='equal' then 1 else (x->>'weight')::bigint end) into denom from jsonb_array_elements(people) x;
 if (mode='custom' and denom<>total) or (mode='percentage' and denom<>10000) then raise exception 'invalid_split'; end if;
 return query with weights as (
 select (x->>'user_id')::uuid u,case when mode='equal' then 1::bigint else (x->>'weight')::bigint end w from jsonb_array_elements(people) x
 ), shares as (select u,w,floor(total::numeric*w/denom)::bigint a,mod(total::numeric*w,denom) r from weights), ranked as (
 select *,row_number() over(order by r desc,u) pos,total-sum(a) over() remaining from shares)
 select u,a+case when pos<=remaining then 1 else 0 end,w from ranked order by u;
end $$;
-- Internal unrestricted aggregate; checked RPC below is the only public interface.
create function public.finance_balances(target uuid) returns table(user_id uuid,balance numeric) language sql stable security definer set search_path='' as $$
 select m.user_id,coalesce(sum(mov.delta),0) from public.home_members m left join (
 select payer u,amount::numeric delta from public.expenses where home_id=target and deleted_at is null
 union all select s.user_id,-s.amount::numeric from public.expense_splits s join public.expenses e on e.id=s.expense_id where e.home_id=target and e.deleted_at is null
 union all select from_user,amount::numeric from public.settlements where home_id=target
 union all select to_user,-amount::numeric from public.settlements where home_id=target
 ) mov on mov.u=m.user_id where m.home_id=target group by m.user_id;
$$;
create function public.expense_balances(target uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_home_member(target) then raise exception 'unauthorized'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('user_id',b.user_id,'balance',b.balance::text,'active',m.active,'name',
 case when m.active then p.name else coalesce((select s.user_name from public.expense_splits s where s.home_id=target and s.user_id=b.user_id limit 1),
 (select e.payer_name from public.expenses e where e.home_id=target and e.payer=b.user_id limit 1),'Roomie') end) order by b.user_id),'[]')
 from public.finance_balances(target) b join public.home_members m on m.home_id=target and m.user_id=b.user_id join public.profiles p on p.id=b.user_id);
end $$;
create function public.my_departed_balance(target uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.home_members where home_id=target and user_id=auth.uid()) then raise exception 'unauthorized'; end if;
 return (select jsonb_build_object('balance',b.balance::text,'currency',h.currency) from public.finance_balances(target) b join public.homes h on h.id=target where b.user_id=auth.uid());
end $$;
create function public.audit_expense(target uuid,item uuid) returns void language sql security definer set search_path='' as $$
 insert into public.expense_events(home_id,expense_id,actor,actor_name,revision,snapshot)
 select target,e.id,auth.uid(),p.name,e.version,jsonb_build_object('expense',to_jsonb(e),'splits',(select jsonb_agg(to_jsonb(s) order by s.user_id) from public.expense_splits s where s.expense_id=e.id))
 from public.expenses e join public.profiles p on p.id=auth.uid() where e.id=item and e.home_id=target;
$$;
-- Public command: all edits serialized, expected version prevents lost updates.
create function public.save_expense(target uuid,item uuid,expected_version integer,body jsonb) returns uuid
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
create function public.delete_expense(target uuid,item uuid,expected_version integer) returns void language plpgsql security definer set search_path='' as $$
declare e public.expenses;
begin
 perform public.organization_lock(target);
 select * into e from public.expenses where home_id=target and id=item;
 if not found then raise exception 'not_found'; end if;
 if e.deleted_at is not null then return; end if;
 if e.version<>expected_version then raise exception 'stale_version'; end if;
 update public.expenses set deleted_at=now(),updated_at=now(),version=version+1 where id=item;
 perform public.audit_expense(target,item);
end $$;
create function public.record_settlement(target uuid,item uuid,sender uuid,recipient uuid,total bigint,on_date date) returns uuid language plpgsql security definer set search_path='' as $$
declare curr text; a numeric; b numeric;
begin
 perform public.organization_lock(target);
 if item is null or total is null or total<1 or total>1000000000000 or sender=recipient or on_date is null then raise exception 'invalid_payment'; end if;
 if exists(select 1 from public.settlements where id=item) then
  if not exists(select 1 from public.settlements where id=item and home_id=target and from_user=sender and to_user=recipient and amount=total and payment_date=on_date) then raise exception 'idempotency_conflict'; end if;
  return item;
 end if;
 if not exists(select 1 from public.home_members where home_id=target and user_id=sender) or not exists(select 1 from public.home_members where home_id=target and user_id=recipient) then raise exception 'invalid_member'; end if;
 select balance into a from public.finance_balances(target) where user_id=sender;
 select balance into b from public.finance_balances(target) where user_id=recipient;
 -- Former members may only move toward zero, not acquire new debt/credit.
 if exists(select 1 from public.home_members where home_id=target and user_id=sender and not active) and (a>=0 or total> -a) then raise exception 'former_payment_limit'; end if;
 if exists(select 1 from public.home_members where home_id=target and user_id=recipient and not active) and (b<=0 or total>b) then raise exception 'former_payment_limit'; end if;
 select currency into curr from public.homes where id=target;
 insert into public.settlements(id,home_id,from_user,to_user,from_name,to_name,amount,currency,payment_date,created_by,created_by_name)
 select item,target,sender,recipient,
 coalesce((select value->>'name' from jsonb_array_elements(public.expense_balances(target)) where value->>'user_id'=sender::text),'Roomie'),
 coalesce((select value->>'name' from jsonb_array_elements(public.expense_balances(target)) where value->>'user_id'=recipient::text),'Roomie'),
 total,curr,on_date,auth.uid(),name from public.profiles where id=auth.uid();
 return item;
end $$;
create function public.reconcile_departure_chores(target uuid) returns integer language plpgsql security definer set search_path='' as $$
declare i public.chore_instances; c public.chores; chosen uuid; nm text; blocked integer:=0;
begin

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
revoke all on function public.reconcile_departure_chores(uuid) from public,anon,authenticated;
create function public.leave_home(target uuid) returns void language plpgsql security definer set search_path='' as $$
declare balance numeric;
begin
 perform public.organization_lock(target);
 select b.balance into balance from public.finance_balances(target) b where b.user_id=auth.uid();
 if balance<>0 then raise exception 'outstanding_balance:%',balance; end if;
 update public.home_members set active=false,left_at=now() where home_id=target and user_id=auth.uid();
 perform public.reconcile_departure_chores(target);
 -- Future automatic work is invalidated by migration 004 membership trigger.
end $$;
create function public.finance_currency_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.currency is distinct from old.currency and (exists(select 1 from public.expenses where home_id=new.id) or exists(select 1 from public.settlements where home_id=new.id) or exists(select 1 from public.recurring_expenses where home_id=new.id)) then raise exception 'currency_has_history'; end if;
 return new;
end $$;
create trigger finance_currency_change before update of currency on public.homes for each row execute function public.finance_currency_guard();
create function public.finance_home_delete_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.finance_balances(old.id) where balance<>0) then raise exception 'home_has_balances'; end if;
 return old;
end $$;
create trigger finance_home_delete before delete on public.homes for each row execute function public.finance_home_delete_guard();
-- Recurrences use anchor + index (January 31 -> February 28 -> March 31, no drift).
create function public.expense_occurrence(anchor date,freq text,n integer,idx integer) returns date language sql immutable set search_path='' as $$
 select case when freq='weekly' then anchor+7*idx else (anchor+make_interval(months=>n*idx))::date end;
$$;
create function public.save_recurring_expense(target uuid,item uuid,expected_version integer,body jsonb,recurrence_kind text,freq text,n integer,anchor date,enabled boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare old public.recurring_expenses; person record; total bigint;
begin
 perform public.organization_lock(target);
 if recurrence_kind is null or freq is null or n is null or enabled is null or item is null or anchor is null or anchor<public.home_local_date(target)-3660 or freq not in ('weekly','monthly') or n not between 1 and 120 or recurrence_kind not in ('fixed','variable') or (freq='weekly' and n<>1) or expected_version is null then raise exception 'invalid_recurrence'; end if;
 select * into old from public.recurring_expenses where id=item;
 if found then
  if old.home_id<>target then raise exception 'not_found'; end if;
  if expected_version=0 then return item; end if;
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
 values(item,target,(body-'shopping_list_id')||case when recurrence_kind='variable' then jsonb_build_object('amount','') else '{}'::jsonb end,recurrence_kind,freq,n,anchor,anchor,enabled,auth.uid());
 else
 -- Schedule edits only affect unissued periods. Restart anchor must be after last issued date.
 if row(anchor,freq,n) is distinct from row(old.anchor_date,old.frequency,old.every_n) and exists(select 1 from public.recurring_expense_instances where recurring_id=item and period_date>=anchor) then raise exception 'anchor_before_history'; end if;
 update public.recurring_expenses set template=(body-'shopping_list_id')||case when recurrence_kind='variable' then jsonb_build_object('amount','') else '{}'::jsonb end,kind=recurrence_kind,frequency=freq,every_n=n,anchor_date=anchor,
 next_index=case when row(anchor,freq,n) is distinct from row(old.anchor_date,old.frequency,old.every_n) then 0 else old.next_index end,
 next_date=case when row(anchor,freq,n) is distinct from row(old.anchor_date,old.frequency,old.every_n) then anchor else old.next_date end,
 active=enabled,version=version+1,updated_at=now() where id=item;
 end if;
 return item;
end $$;
create function public.generate_recurring_expenses(target uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.recurring_expenses; item uuid; expense uuid; due date; idx integer; made integer:=0; blocked boolean; payload jsonb;
begin
 perform public.organization_lock(target);
 for r in select * from public.recurring_expenses where home_id=target and active and next_date<=public.home_local_date(target) order by next_date,id loop
 due:=r.next_date; idx:=r.next_index;
 while due<=public.home_local_date(target) and made<120 loop
 payload:=r.template||jsonb_build_object('date',due);
 insert into public.recurring_expense_instances(home_id,recurring_id,period_date,template,recurrence_kind,status)
 values(target,r.id,due,payload,r.kind,'pending') on conflict(recurring_id,period_date) do nothing returning id into item;
 if item is not null then
 blocked:=not exists(select 1 from public.home_members where home_id=target and user_id=(payload->>'payer')::uuid and active)
 or exists(select 1 from jsonb_array_elements(payload->'participants') x where not exists(select 1 from public.home_members where home_id=target and user_id=(x->>'user_id')::uuid and active));
 if r.kind='fixed' and not blocked then
 expense:=public.save_expense(target,item,0,payload);
 update public.recurring_expense_instances set status='posted',expense_id=expense,updated_at=now() where id=item;
 end if;
 end if;
 made:=made+1; idx:=idx+1; due:=public.expense_occurrence(r.anchor_date,r.frequency,r.every_n,idx);
 end loop;
 update public.recurring_expenses set next_index=idx,next_date=due,updated_at=now() where id=r.id;
 end loop;
 return jsonb_build_object('processed',made,'more',exists(select 1 from public.recurring_expenses where home_id=target and active and next_date<=public.home_local_date(target)));
end $$;
create function public.confirm_recurring_expense(target uuid,item uuid,body jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare i public.recurring_expense_instances; result uuid;
begin
 perform public.organization_lock(target);
 select * into i from public.recurring_expense_instances where home_id=target and id=item;
 if not found then raise exception 'not_found'; end if;
 if i.status='posted' then return i.expense_id; end if;
 result:=public.save_expense(target,item,0,(body-'shopping_list_id')||jsonb_build_object('date',i.period_date));
 update public.recurring_expense_instances set status='posted',expense_id=result,updated_at=now() where id=item;
 return result;
end $$;
-- Deferred invariant catches inconsistent writes even from future code paths.
create function public.expense_total_guard() returns trigger language plpgsql set search_path='' as $$
declare item uuid; total bigint;
begin
 if tg_table_name='expenses' then item:=coalesce(new.id,old.id); else item:=coalesce(new.expense_id,old.expense_id); end if;
 select amount into total from public.expenses where id=item;
 if found and (select coalesce(sum(amount),0) from public.expense_splits where expense_id=item)<>total then raise exception 'invalid_split_total'; end if;
 return null;
end $$;
create constraint trigger expense_total_check after insert or update on public.expenses deferrable initially deferred for each row execute function public.expense_total_guard();
create constraint trigger splits_total_check after insert or update or delete on public.expense_splits deferrable initially deferred for each row execute function public.expense_total_guard();
-- Receipt upload is private. Random immutable object paths, no UPDATE/upsert permission.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('expense-receipts','expense-receipts',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf']);
create function public.can_access_receipt(object_name text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.expenses e where e.home_id::text=split_part(object_name,'/',1) and e.id::text=split_part(object_name,'/',2) and public.is_home_member(e.home_id));
$$;
create policy receipt_read on storage.objects for select to authenticated using(bucket_id='expense-receipts' and public.can_access_receipt(name));
create policy receipt_insert on storage.objects for insert to authenticated with check(bucket_id='expense-receipts' and public.can_access_receipt(name) and name ~ '\.(jpg|png|webp|pdf)$');
create policy receipt_delete on storage.objects for delete to authenticated using(bucket_id='expense-receipts' and public.can_access_receipt(name) and not exists(select 1 from public.expense_attachments a where a.path=name));
create function public.attach_expense_receipt(target uuid,item uuid,object_path text,media_type text,byte_size integer) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.organization_lock(target);
 if not exists(select 1 from public.expenses where home_id=target and id=item and deleted_at is null) or object_path not like target::text||'/'||item::text||'/%' then raise exception 'not_found'; end if;
 if not exists(select 1 from storage.objects where bucket_id='expense-receipts' and name=object_path) then raise exception 'receipt_missing'; end if;
 insert into public.expense_attachments(home_id,expense_id,path,mime,size) values(target,item,object_path,media_type,byte_size) on conflict(path) do nothing;
 -- Trigger a parent update for realtime attachment visibility, without changing financial version.
 update public.expenses set updated_at=now() where id=item;
end $$;
revoke all on function public.finance_balances(uuid),public.audit_expense(uuid,uuid),public.finance_currency_guard(),public.finance_home_delete_guard(),public.expense_total_guard() from public,anon,authenticated;
revoke all on function public.currency_scale(text),public.money_split(bigint,text,jsonb),public.expense_occurrence(date,text,integer,integer),public.expense_balances(uuid),public.my_departed_balance(uuid),public.save_expense(uuid,uuid,integer,jsonb),public.delete_expense(uuid,uuid,integer),public.record_settlement(uuid,uuid,uuid,uuid,bigint,date),public.leave_home(uuid),public.save_recurring_expense(uuid,uuid,integer,jsonb,text,text,integer,date,boolean),public.generate_recurring_expenses(uuid),public.confirm_recurring_expense(uuid,uuid,jsonb),public.can_access_receipt(text),public.attach_expense_receipt(uuid,uuid,text,text,integer) from public,anon;
grant execute on function public.currency_scale(text),public.money_split(bigint,text,jsonb),public.expense_occurrence(date,text,integer,integer),public.expense_balances(uuid),public.my_departed_balance(uuid),public.save_expense(uuid,uuid,integer,jsonb),public.delete_expense(uuid,uuid,integer),public.record_settlement(uuid,uuid,uuid,uuid,bigint,date),public.leave_home(uuid),public.save_recurring_expense(uuid,uuid,integer,jsonb,text,text,integer,date,boolean),public.generate_recurring_expenses(uuid),public.confirm_recurring_expense(uuid,uuid,jsonb),public.can_access_receipt(text),public.attach_expense_receipt(uuid,uuid,text,text,integer) to authenticated;
alter publication supabase_realtime add table public.expenses,public.settlements,public.recurring_expenses,public.recurring_expense_instances;
commit;
