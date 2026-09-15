-- Additive phase 1 correction. Keep 202609150001_foundation.sql unchanged.
begin;

alter table public.homes drop constraint homes_currency_check;
alter table public.homes add constraint homes_currency_format_check
  check (char_length(currency) = 3 and currency ~ '^[A-Z]{3}$');

create or replace function public.can_read_profile(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select target=(select auth.uid()) or exists (
  select 1 from public.home_members mine
  join public.home_members theirs on theirs.home_id=mine.home_id
  where mine.user_id=(select auth.uid()) and mine.active
    and theirs.user_id=target and theirs.active
 );
$$;
-- Existing profile and avatar SELECT policies call this function.
-- Reassert privileges explicitly; do not grant anonymous access.
revoke execute on function public.can_read_profile(uuid) from public, anon;
grant execute on function public.can_read_profile(uuid) to authenticated;

commit;
