-- Unified activity pagination; invoker privileges preserve the source tables' RLS.
begin;
create index expense_events_home_recorded on public.expense_events(home_id,recorded_at desc,id);
create index settlements_home_created on public.settlements(home_id,created_at desc,id);
create function public.expense_activity(target uuid, page_index integer default 0)
returns table(id uuid, kind text, recorded_at timestamptz, payload jsonb)
language sql stable security invoker set search_path='' as $$
 select activity.id,activity.kind,activity.recorded_at,activity.payload
 from (
  select e.id,'revision'::text kind,e.recorded_at,to_jsonb(e) payload
  from public.expense_events e where e.home_id=target and auth.uid() is not null
  union all
  select s.id,'payment'::text,s.created_at,to_jsonb(s)
  from public.settlements s where s.home_id=target and auth.uid() is not null
 ) activity
 order by activity.recorded_at desc,activity.kind,activity.id
 limit 50 offset (greatest(0,least(page_index,999999))::bigint*50);
$$;
revoke all on function public.expense_activity(uuid,integer) from public,anon;
grant execute on function public.expense_activity(uuid,integer) to authenticated;
-- Return numeric sums as text, never as an unsafe JSON number. Filtering and
-- aggregation happen before pagination, over the active ledger visible via RLS.
create function public.expense_category_totals(target uuid, selected_category text default null)
returns table(category text, amount text)
language sql stable security invoker set search_path='' as $$
 select e.category,sum(e.amount::numeric)::text
 from public.expenses e
 where e.home_id=target and e.deleted_at is null and auth.uid() is not null
   and (selected_category is null or e.category=selected_category)
 group by e.category;
$$;
revoke all on function public.expense_category_totals(uuid,text) from public,anon;
grant execute on function public.expense_category_totals(uuid,text) to authenticated;
commit;
