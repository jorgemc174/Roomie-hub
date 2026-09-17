-- One general chat per home; writes use the same home lock as membership changes.
begin;
create schema messaging_private;
revoke all on schema messaging_private from public,anon,authenticated;
create table public.chat_messages (
 id uuid primary key, home_id uuid not null references public.homes on delete cascade,
 author_user_id uuid not null, author_name text not null,
 body text not null check(length(body)<=4000), reply_to uuid,
 created_at timestamptz not null default now(), edited_at timestamptz, deleted_at timestamptz,
 version integer not null default 1,
 unique(home_id,id),
 foreign key(home_id,author_user_id) references public.home_members(home_id,user_id),
 foreign key(home_id,reply_to) references public.chat_messages(home_id,id),
 check(reply_to is distinct from id)
);
create index chat_home_cursor on public.chat_messages(home_id,created_at desc,id desc);
create table public.chat_reactions (
 home_id uuid not null, message_id uuid not null, user_id uuid not null,
 emoji text not null check(emoji in ('👍','❤️','😂','🎉','😮','🙏')),
 active boolean not null default true, updated_at timestamptz not null default now(),
 primary key(message_id,user_id,emoji),
 foreign key(home_id,message_id) references public.chat_messages(home_id,id) on delete cascade,
 foreign key(home_id,user_id) references public.home_members(home_id,user_id)
);
create index chat_reactions_home on public.chat_reactions(home_id,message_id) where active;
create table public.chat_attachments (
 id uuid primary key, home_id uuid not null references public.homes on delete cascade,
 message_id uuid, uploaded_by uuid not null references public.profiles,
 path text not null unique, file_name text not null check(length(file_name) between 1 and 120),
 mime text not null check(mime in ('image/webp','application/pdf','text/plain')),
 checksum text not null check(checksum ~ '^[a-f0-9]{64}$'),
 size integer not null check(size between 1 and 10485760), created_at timestamptz not null default now(),
 foreign key(home_id,message_id) references public.chat_messages(home_id,id) on delete cascade
);
create index chat_attachments_message on public.chat_attachments(home_id,message_id);
create table messaging_private.chat_requests (
 message_id uuid primary key references public.chat_messages on delete cascade,
 author_id uuid not null, request jsonb not null
);
create table messaging_private.chat_audit (
 id bigint generated always as identity primary key,
 message_id uuid not null references public.chat_messages on delete cascade,
 actor uuid not null references public.profiles, recorded_at timestamptz not null default now(), snapshot jsonb not null
);
create table messaging_private.rate_limits (
 home_id uuid not null references public.homes on delete cascade, user_id uuid not null references public.profiles,
 operation text not null, window_at timestamptz not null, amount integer not null,
 primary key(home_id,user_id,operation,window_at)
);
do $$ declare t text;begin
 foreach t in array array['chat_messages','chat_reactions','chat_attachments'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop;
 foreach t in array array['chat_requests','chat_audit','rate_limits'] loop
 execute format('alter table messaging_private.%I enable row level security',t);
 execute format('revoke all on messaging_private.%I from public,anon,authenticated',t);
 end loop;
end $$;
create policy chat_read on public.chat_messages for select to authenticated using(public.is_home_member(home_id));
create policy reaction_read on public.chat_reactions for select to authenticated using(public.is_home_member(home_id));
create policy attachment_read on public.chat_attachments for select to authenticated using(public.is_home_member(home_id) and
 ((message_id is null and uploaded_by=auth.uid()) or exists(select 1 from public.chat_messages m where m.id=message_id and m.deleted_at is null)));

create function messaging_private.throttle(target uuid,action text,max_count integer) returns void
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 insert into messaging_private.rate_limits(home_id,user_id,operation,window_at,amount)
 values(target,auth.uid(),action,date_trunc('minute',now()),1)
 on conflict(home_id,user_id,operation,window_at) do update set amount=messaging_private.rate_limits.amount+1 returning amount into n;
 if n>max_count then raise exception 'rate_limited';end if;
end $$;

create function public.send_chat_message(target uuid,item uuid,message_body text,reply uuid default null,files uuid[] default '{}') returns uuid
language plpgsql security definer set search_path='' as $$
declare prior messaging_private.chat_requests;request jsonb;nm text;f uuid;
begin
 perform public.organization_lock(target);
 if item is null or message_body is null or files is null or length(message_body)>4000 or cardinality(files)>3 then raise exception 'invalid_message';end if;
 request:=jsonb_build_object('home',target,'body',message_body,'reply',reply,'files',files);
 select * into prior from messaging_private.chat_requests where message_id=item;
 if found then
  if prior.author_id=auth.uid() and prior.request=request then return item;end if;
  raise exception 'idempotency_conflict';
 end if;
 if length(trim(message_body))=0 and cardinality(files)=0 then raise exception 'invalid_message';end if;
 if reply is not null and not exists(select 1 from public.chat_messages where home_id=target and id=reply) then raise exception 'invalid_reply';end if;
 if cardinality(files)<>(select count(distinct x) from unnest(files) x) then raise exception 'invalid_attachment';end if;
 foreach f in array files loop
  if not exists(select 1 from public.chat_attachments a join storage.objects o on o.bucket_id='chat-files' and o.name=a.path
   where a.id=f and a.home_id=target and a.uploaded_by=auth.uid() and a.message_id is null and a.created_at>now()-interval '1 hour') then raise exception 'invalid_attachment';end if;
 end loop;
 perform messaging_private.throttle(target,'send',30);
 select name into nm from public.profiles where id=auth.uid();
 insert into public.chat_messages(id,home_id,author_user_id,author_name,body,reply_to) values(item,target,auth.uid(),nm,message_body,reply);
 insert into messaging_private.chat_requests values(item,auth.uid(),request);
 update public.chat_attachments set message_id=item where id=any(files);
 return item;
end $$;
create function public.edit_chat_message(target uuid,item uuid,expected_version integer,message_body text) returns void
language plpgsql security definer set search_path='' as $$
declare m public.chat_messages;
begin
 perform public.organization_lock(target);
 select * into m from public.chat_messages where home_id=target and id=item;
 if not found or m.deleted_at is not null then raise exception 'not_found';end if;
 if m.author_user_id<>auth.uid() then raise exception 'not_author';end if;
 if expected_version is null or m.version<>expected_version then raise exception 'stale_version';end if;
 if message_body is null or length(message_body)>4000 or (length(trim(message_body))=0 and not exists(select 1 from public.chat_attachments where message_id=item)) then raise exception 'invalid_message';end if;
 if m.body=message_body then return;end if;
 perform messaging_private.throttle(target,'edit',60);
 insert into messaging_private.chat_audit(message_id,actor,snapshot) values(item,auth.uid(),to_jsonb(m));
 update public.chat_messages set body=message_body,edited_at=now(),version=version+1 where id=item;
end $$;
-- All active members may remove visible content, but only its author may edit text.
create function public.delete_chat_message(target uuid,item uuid,expected_version integer) returns void
language plpgsql security definer set search_path='' as $$
declare m public.chat_messages;
begin
 perform public.organization_lock(target);
 select * into m from public.chat_messages where home_id=target and id=item;
 if not found then raise exception 'not_found';end if;
 if m.deleted_at is not null then return;end if;
 if expected_version is null or m.version<>expected_version then raise exception 'stale_version';end if;
 perform messaging_private.throttle(target,'delete',30);
 insert into messaging_private.chat_audit(message_id,actor,snapshot) values(item,auth.uid(),to_jsonb(m));
 update public.chat_messages set body='',deleted_at=now(),version=version+1 where id=item;
 update public.chat_reactions set active=false,updated_at=now() where message_id=item and active;
end $$;
create function public.set_chat_reaction(target uuid,item uuid,reaction text,enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.organization_lock(target);
 if reaction is null or reaction not in ('👍','❤️','😂','🎉','😮','🙏') or enabled is null then raise exception 'invalid_reaction';end if;
 if not exists(select 1 from public.chat_messages where home_id=target and id=item and deleted_at is null) then raise exception 'not_found';end if;
 if exists(select 1 from public.chat_reactions where message_id=item and user_id=auth.uid() and emoji=reaction and active=enabled) then return;end if;
 perform messaging_private.throttle(target,'reaction',60);
 insert into public.chat_reactions(home_id,message_id,user_id,emoji,active) values(target,item,auth.uid(),reaction,enabled)
 on conflict(message_id,user_id,emoji) do update set active=excluded.active,updated_at=now();
end $$;
create function public.prepare_chat_attachment(target uuid,item uuid,label text,media_type text,byte_size integer,content_hash text) returns text
language plpgsql security definer set search_path='' as $$
declare p text;prior public.chat_attachments;
begin
 perform public.organization_lock(target);
 if content_hash is null or content_hash !~ '^[a-f0-9]{64}$' or item is null or label is null or length(label) not between 1 and 120 or label ~ '[[:cntrl:]/\\]' or media_type is null or media_type not in ('image/webp','application/pdf','text/plain') or byte_size is null or byte_size not between 1 and 10485760 then raise exception 'invalid_attachment';end if;
 select * into prior from public.chat_attachments where id=item;
 if found then
  if prior.home_id=target and prior.uploaded_by=auth.uid() and prior.file_name=label and prior.mime=media_type and prior.size=byte_size and prior.checksum=content_hash then return prior.path;end if;
  raise exception 'idempotency_conflict';
 end if;
 perform messaging_private.throttle(target,'upload',10);
 p:=target::text||'/'||item::text||'/'||gen_random_uuid()::text;
 insert into public.chat_attachments(id,home_id,uploaded_by,path,file_name,mime,size,checksum) values(item,target,auth.uid(),p,label,media_type,byte_size,content_hash);
 return p;
end $$;
create function public.chat_file_access(object_path text,write_access boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.chat_attachments a where a.path=object_path and public.is_home_member(a.home_id) and
 case when write_access then a.message_id is null and a.uploaded_by=auth.uid() and a.created_at>now()-interval '1 hour'
 else (a.message_id is null and a.uploaded_by=auth.uid()) or exists(select 1 from public.chat_messages m where m.id=a.message_id and m.deleted_at is null) end);
$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('chat-files','chat-files',false,10485760,array['image/webp','application/pdf','text/plain']);
create policy chat_file_read on storage.objects for select to authenticated using(bucket_id='chat-files' and public.chat_file_access(name));
create policy chat_file_insert on storage.objects for insert to authenticated with check(bucket_id='chat-files' and public.chat_file_access(name,true));
create policy chat_file_delete on storage.objects for delete to authenticated using(bucket_id='chat-files' and public.chat_file_access(name,true));
create function messaging_private.scrub_file_metadata() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.bucket_id='chat-files' then
  new.owner:=null;new.owner_id:=null;new.user_metadata:='{}';
  new.metadata:=jsonb_build_object('size',new.metadata->'size','mimetype',new.metadata->'mimetype','cacheControl',new.metadata->'cacheControl','eTag',new.metadata->'eTag','lastModified',new.metadata->'lastModified');
 end if;return new;
end $$;
create trigger chat_file_metadata before insert or update on storage.objects for each row execute function messaging_private.scrub_file_metadata();

-- Limit 50, lexicographic keyset cursor; replies are references, not copied message bodies.
create function public.chat_page(target uuid,before_at timestamptz default null,before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ids uuid[];messages jsonb;replies jsonb;attachments jsonb;reactions jsonb;
begin
 if not public.is_home_member(target) then raise exception 'unauthorized';end if;
 if (before_at is null)<>(before_id is null) or (before_at is not null and not isfinite(before_at)) then raise exception 'invalid_cursor';end if;
 select array_agg(id),coalesce(jsonb_agg(to_jsonb(m) order by m.created_at,m.id),'[]') into ids,messages
 from (select * from public.chat_messages where home_id=target and (before_at is null or (created_at,id)<(before_at,before_id)) order by created_at desc,id desc limit 50) m;
 select coalesce(jsonb_agg(to_jsonb(m)),'[]') into replies from public.chat_messages m where home_id=target and id in(select reply_to from public.chat_messages where id=any(ids));
 select coalesce(jsonb_agg(to_jsonb(a)),'[]') into attachments from public.chat_attachments a join public.chat_messages m on m.id=a.message_id where a.message_id=any(ids) and m.deleted_at is null;
 select coalesce(jsonb_agg(to_jsonb(r)),'[]') into reactions from
 (select message_id,emoji,count(*)::integer count,bool_or(user_id=auth.uid()) mine from public.chat_reactions where message_id=any(ids) and active group by message_id,emoji) r;
 return jsonb_build_object('messages',messages,'replies',replies,'attachments',attachments,'reactions',reactions);
end $$;
revoke all on all functions in schema messaging_private from public,anon,authenticated;
revoke all on function public.send_chat_message(uuid,uuid,text,uuid,uuid[]),public.edit_chat_message(uuid,uuid,integer,text),public.delete_chat_message(uuid,uuid,integer),public.set_chat_reaction(uuid,uuid,text,boolean),public.prepare_chat_attachment(uuid,uuid,text,text,integer,text),public.chat_file_access(text,boolean),public.chat_page(uuid,timestamptz,uuid) from public,anon;
grant execute on function public.send_chat_message(uuid,uuid,text,uuid,uuid[]),public.edit_chat_message(uuid,uuid,integer,text),public.delete_chat_message(uuid,uuid,integer),public.set_chat_reaction(uuid,uuid,text,boolean),public.prepare_chat_attachment(uuid,uuid,text,text,integer,text),public.chat_file_access(text,boolean),public.chat_page(uuid,timestamptz,uuid) to authenticated;
alter publication supabase_realtime add table public.chat_messages,public.chat_reactions,public.chat_attachments;
commit;
