-- PA 2411 (Sprint 2): a member cannot have two live absences that overlap in the same home.
-- Additive: redefines save_absence from its current definition (202609150003_organization.sql)
-- and adds the overlap check under the same home lock. Both ends are inclusive and the row
-- being edited is excluded. Existing rows are not modified; deletions are unaffected.
begin;
create or replace function public.save_absence(target uuid,absence uuid,person uuid,starts date,ends date,remove boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; nm text;
begin
 perform public.organization_lock(target);
 if remove then
  update public.absences set deleted_at=now(),updated_at=now() where home_id=target and id=absence and deleted_at is null returning id into result;
 else
  if not exists(select 1 from public.home_members where home_id=target and user_id=person and active) then raise exception 'invalid_member'; end if;
  if starts is null or ends is null then raise exception 'invalid_absence_dates'; end if;
  if ends<starts then raise exception 'absence_end_before_start'; end if;
  if exists(
   select 1 from public.absences a
   where a.home_id=target and a.user_id=person and a.deleted_at is null
     and (absence is null or a.id<>absence)
     and a.start_date<=ends and a.end_date>=starts
  ) then raise exception 'absence_overlap'; end if;
  select name into nm from public.profiles where id=person;
  if absence is null then
   insert into public.absences(home_id,user_id,user_name,start_date,end_date) values(target,person,nm,starts,ends) returning id into result;
  else
   update public.absences set user_id=person,user_name=nm,start_date=starts,end_date=ends,updated_at=now()
   where id=absence and home_id=target and deleted_at is null returning id into result;
  end if;
 end if;
 if result is null then raise exception 'not_found'; end if;
 perform public.reconcile_chore_assignments(target);
 return result;
end $$;
revoke all on function public.save_absence(uuid,uuid,uuid,date,date,boolean) from public,anon;
grant execute on function public.save_absence(uuid,uuid,uuid,date,date,boolean) to authenticated;
commit;
