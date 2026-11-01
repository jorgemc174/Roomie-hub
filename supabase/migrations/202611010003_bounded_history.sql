-- Bound display reads without altering generation, assignment, RLS or write privileges.
begin;

create index chore_assignment_events_instance_time
  on public.chore_assignment_events(home_id,instance_id,created_at,id);
create index chore_instances_home_assignee_period
  on public.chore_instances(home_id,assignee_id,period_start,id);
create index reservations_home_end on public.reservations(home_id,ends_at);
create index reservations_home_resource_time
  on public.reservations(home_id,resource_id,starts_at,id);
create index reservations_home_cancelled on public.reservations(home_id,cancelled_at)
  where cancelled_at is not null;
create index activities_home_end on public.activities(home_id,ends_at);
create index activities_home_cancelled on public.activities(home_id,cancelled_at)
  where cancelled_at is not null;
create index activity_members_home_activity on public.activity_members(home_id,activity_id,user_id);

-- Invoker privileges: both tables retain their existing active-membership RLS.
-- The end is exclusive; a booking ending at midnight is absent from the new day.
-- PostgreSQL handles local boundaries, including days lasting 23 or 25 hours.
create function public.reservations_on_day(target uuid,on_day date)
returns setof public.reservations language sql stable security invoker set search_path='' as $$
  select r.* from public.reservations r join public.homes h on h.id=r.home_id
  where r.home_id=target
    and r.cancelled_at is null
    and r.starts_at < ((on_day+1)::timestamp at time zone h.timezone)
    and r.ends_at > (on_day::timestamp at time zone h.timezone)
$$;
revoke all on function public.reservations_on_day(uuid,date) from public,anon;
grant execute on function public.reservations_on_day(uuid,date) to authenticated;

commit;
