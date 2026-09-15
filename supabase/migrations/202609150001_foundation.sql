-- RoomieHub phase 1. Run as the database migration role.
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 name text not null check (char_length(trim(name)) between 2 and 80),
 avatar_path text,
 locale text not null default 'es' check (locale in ('es','en')),
 theme text not null default 'light' check (theme in ('light','dark')),
 created_at timestamptz not null default now(),
 constraint profile_avatar_path check (avatar_path is null or avatar_path like id::text || '/%')
);
create table public.homes (
 id uuid primary key default gen_random_uuid(),
 name text not null check (char_length(trim(name)) between 2 and 80),
 image_path text,
 currency text not null default 'EUR' check (currency in ('EUR','USD','GBP')),
 week_starts_on smallint not null default 1 check (week_starts_on between 0 and 6),
 created_at timestamptz not null default now(),
 constraint home_image_path check (image_path is null or image_path like id::text || '/%')
);
create table public.home_members (
 home_id uuid not null references public.homes on delete cascade,
 user_id uuid not null references public.profiles on delete restrict,
 active boolean not null default true,
 joined_at timestamptz not null default now(),
 left_at timestamptz,
 primary key(home_id,user_id),
 check ((active and left_at is null) or (not active and left_at is not null))
);
create index home_members_user_idx on public.home_members(user_id,home_id) where active;
create table public.invitations (
 home_id uuid primary key references public.homes on delete cascade,
 code text not null unique default replace(gen_random_uuid()::text,'-',''),
 regenerated_at timestamptz not null default now()
);

create function public.is_home_member(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.home_members where home_id=target and user_id=(select auth.uid()) and active);
$$;
create function public.can_read_profile(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select target=(select auth.uid()) or exists (
  select 1 from public.home_members mine join public.home_members theirs on theirs.home_id=mine.home_id
  where mine.user_id=(select auth.uid()) and mine.active and theirs.user_id=target
 );
$$;
alter table public.profiles enable row level security;
alter table public.homes enable row level security;
alter table public.home_members enable row level security;
alter table public.invitations enable row level security;
create policy profiles_read on public.profiles for select to authenticated using (public.can_read_profile(id));
create policy profiles_update on public.profiles for update to authenticated using (id=(select auth.uid())) with check (id=(select auth.uid()));
create policy homes_read on public.homes for select to authenticated using (public.is_home_member(id));
create policy members_read on public.home_members for select to authenticated using (public.is_home_member(home_id));
create policy invitations_read on public.invitations for select to authenticated using (public.is_home_member(home_id));
revoke all on public.profiles,public.homes,public.home_members,public.invitations from anon,authenticated;
grant select on public.profiles,public.homes,public.home_members,public.invitations to authenticated;
grant update(name,avatar_path,locale,theme) on public.profiles to authenticated;

create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into public.profiles(id,name) values(new.id,
 case when char_length(trim(coalesce(new.raw_user_meta_data->>'name',new.raw_user_meta_data->>'full_name',''))) between 2 and 80
 then trim(coalesce(new.raw_user_meta_data->>'name',new.raw_user_meta_data->>'full_name')) else 'Roomie' end);
 return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create function public.create_home(home_name text, home_currency text default 'EUR') returns uuid
language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
 if auth.uid() is null then raise exception 'unauthorized'; end if;
 insert into public.homes(name,currency) values(trim(home_name),home_currency) returning id into result;
 insert into public.home_members(home_id,user_id) values(result,auth.uid());
 insert into public.invitations(home_id) values(result);
 return result;
end; $$;

create function public.join_home(invite_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
 if auth.uid() is null then raise exception 'unauthorized'; end if;
 select home_id into target from public.invitations where code=lower(trim(invite_code));
 if target is null then raise exception 'invalid_invitation'; end if;
 -- Serialize join, rotation and deletion against the same home row.
 perform 1 from public.homes where id=target for update;
 if not found or not exists(select 1 from public.invitations where home_id=target and code=lower(trim(invite_code))) then raise exception 'invalid_invitation'; end if;
 insert into public.home_members(home_id,user_id) values(target,auth.uid())
 on conflict(home_id,user_id) do update set active=true,left_at=null;
 return target;
end; $$;

create function public.update_home(target uuid, home_name text, home_currency text, home_image text, week_start smallint) returns void
language plpgsql security definer set search_path = '' as $$
begin
 perform 1 from public.homes where id=target for update;
 if not public.is_home_member(target) then raise exception 'unauthorized'; end if;
 update public.homes set name=trim(home_name),currency=home_currency,image_path=home_image,week_starts_on=week_start where id=target;
end; $$;

create function public.regenerate_invitation(target uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare result text;
begin
 perform 1 from public.homes where id=target for update;
 if not public.is_home_member(target) then raise exception 'unauthorized'; end if;
 update public.invitations set code=replace(gen_random_uuid()::text,'-',''),regenerated_at=now() where home_id=target returning code into result;
 return result;
end; $$;

create function public.delete_home(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
 perform 1 from public.homes where id=target for update;
 if not public.is_home_member(target) then raise exception 'unauthorized'; end if;
 if (select count(*) from public.home_members where home_id=target and active)<>1 then raise exception 'home_has_members'; end if;
 delete from public.homes where id=target;
end; $$;

revoke execute on function public.handle_new_user() from public,anon,authenticated;
revoke execute on function public.is_home_member(uuid), public.can_read_profile(uuid), public.create_home(text,text), public.join_home(text), public.update_home(uuid,text,text,text,smallint), public.regenerate_invitation(uuid), public.delete_home(uuid) from public,anon;
grant execute on function public.is_home_member(uuid), public.can_read_profile(uuid), public.create_home(text,text), public.join_home(text), public.update_home(uuid,text,text,text,smallint), public.regenerate_invitation(uuid), public.delete_home(uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('avatars','avatars',false,5242880,array['image/jpeg','image/png','image/webp']),
 ('home-images','home-images',false,5242880,array['image/jpeg','image/png','image/webp']);
create policy avatar_read on storage.objects for select to authenticated using (bucket_id='avatars' and public.can_read_profile((storage.foldername(name))[1]::uuid));
create policy avatar_insert on storage.objects for insert to authenticated with check (bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text and name ~ '\.(png|jpg|jpeg|webp)$');
create policy avatar_delete on storage.objects for delete to authenticated using (bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text);
create policy home_image_read on storage.objects for select to authenticated using (bucket_id='home-images' and public.is_home_member((storage.foldername(name))[1]::uuid));
create policy home_image_insert on storage.objects for insert to authenticated with check (bucket_id='home-images' and public.is_home_member((storage.foldername(name))[1]::uuid) and name ~ '\.(png|jpg|jpeg|webp)$');
create policy home_image_delete on storage.objects for delete to authenticated using (bucket_id='home-images' and public.is_home_member((storage.foldername(name))[1]::uuid));

-- No invitations or profiles in the publication: avoid broadcasting sensitive metadata.
alter publication supabase_realtime add table public.homes, public.home_members;
