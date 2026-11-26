-- Predefined consequences: any active member can keep a reusable list per home.
-- Additive: punishments keep their own copied description, so editing or removing a preset never changes history.
begin;
create table public.punishment_presets (
 id uuid primary key,home_id uuid not null references public.homes on delete cascade,
 description text not null check(length(trim(description)) between 1 and 500 and description=trim(description)),
 severity text check(severity in ('light','heavy')),
 version integer not null default 1,created_at timestamptz not null default now(),unique(home_id,id)
);
create unique index punishment_presets_unique_text on public.punishment_presets(home_id,lower(description));
alter table public.punishment_presets enable row level security;
revoke all on public.punishment_presets from anon,authenticated;
grant select on public.punishment_presets to authenticated;
create policy member_read on public.punishment_presets for select to authenticated using(public.is_home_member(home_id));

create function public.save_punishment_preset(target uuid,item uuid,expected_version integer,label text,level text)
returns uuid language plpgsql security definer set search_path='' as $$
declare p public.punishment_presets;txt text:=trim(regexp_replace(coalesce(label,''),'\s+',' ','g'));sev text:=nullif(trim(coalesce(level,'')),'');
begin
 perform public.organization_lock(target);
 if item is null or expected_version is null or length(txt) not between 1 and 500 or (sev is not null and sev not in ('light','heavy')) then
  raise exception 'invalid_preset';
 end if;
 select * into p from public.punishment_presets where id=item;
 if found then
  if p.home_id<>target then raise exception 'not_found'; end if;
  -- Idempotent retry of the creation request.
  if expected_version=0 and row(p.description,p.severity) is not distinct from row(txt,sev) then return item; end if;
  if p.version<>expected_version then raise exception 'stale_version'; end if;
  if exists(select 1 from public.punishment_presets where home_id=target and id<>item and lower(description)=lower(txt)) then raise exception 'duplicate_preset'; end if;
  update public.punishment_presets set description=txt,severity=sev,version=version+1 where id=item;
 else
  if expected_version<>0 then raise exception 'not_found'; end if;
  if exists(select 1 from public.punishment_presets where home_id=target and lower(description)=lower(txt)) then raise exception 'duplicate_preset'; end if;
  insert into public.punishment_presets(id,home_id,description,severity) values(item,target,txt,sev);
 end if;
 return item;
end $$;

create function public.delete_punishment_preset(target uuid,item uuid,expected_version integer)
returns void language plpgsql security definer set search_path='' as $$
declare p public.punishment_presets;
begin
 perform public.organization_lock(target);
 select * into p from public.punishment_presets where id=item and home_id=target;
 if not found then return; end if; -- already removed: idempotent
 if expected_version is null or p.version<>expected_version then raise exception 'stale_version'; end if;
 delete from public.punishment_presets where id=item;
end $$;

revoke all on function public.save_punishment_preset(uuid,uuid,integer,text,text),public.delete_punishment_preset(uuid,uuid,integer) from public,anon;
grant execute on function public.save_punishment_preset(uuid,uuid,integer,text,text),public.delete_punishment_preset(uuid,uuid,integer) to authenticated;
alter publication supabase_realtime add table public.punishment_presets;
commit;
