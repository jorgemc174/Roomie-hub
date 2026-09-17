-- Apply ONCE after 009. Generated bundle of migrations 010, 011 and 012.

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


-- Canonical private inbox; external channels are deliveries of these same records.
begin;
create table public.notification_preferences (
 user_id uuid not null references public.profiles on delete cascade,
 category text not null check(category in ('tasks','reservations','activities','expenses','community','chat')),
 in_app boolean not null default true,email boolean not null default false,push boolean not null default false,
 reminder_minutes integer[] not null default array[60] check(reminder_minutes <@ array[15,60,1440] and cardinality(reminder_minutes)<=3),
 version integer not null default 1,primary key(user_id,category)
);
create table public.notifications (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles on delete cascade,
 home_id uuid not null references public.homes on delete cascade,category text not null,event_type text not null,
 title text not null,body text not null,target_url text not null check(target_url ~ '^/homes/[0-9a-f-]{36}(/|$)' and target_url !~ '[[:cntrl:]\\]'),
 source_table text not null,source_id uuid not null,source_version text not null,
 event_at timestamptz,reminder_minutes integer,visible boolean not null,
 dedupe_key text not null,created_at timestamptz not null default now(),read_at timestamptz,invalidated_at timestamptz,
 unique(user_id,dedupe_key)
);
create index notifications_inbox on public.notifications(user_id,created_at desc,id desc) where visible and invalidated_at is null;
create index notifications_unread on public.notifications(user_id,home_id) where visible and read_at is null and invalidated_at is null;
create table public.push_subscriptions (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles on delete cascade,
 endpoint text not null unique check(length(endpoint)<=2048 and endpoint ~ '^https://(fcm\.googleapis\.com|[a-z0-9.-]+\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/'),
 p256dh text not null check(p256dh ~ '^[A-Za-z0-9_-]{87,88}$'),auth_key text not null check(auth_key ~ '^[A-Za-z0-9_-]{22,24}$'),
 active boolean not null default true,label text not null default '' check(length(label)<=80),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index push_user_active on public.push_subscriptions(user_id) where active;
create table messaging_private.notification_deliveries (
 id uuid primary key default gen_random_uuid(),notification_id uuid not null references public.notifications on delete cascade,
 channel text not null check(channel in ('email','push')),subscription_id uuid references public.push_subscriptions on delete cascade,
 status text not null default 'pending' check(status in ('pending','processing','retry','sent','failed','cancelled')),
 attempts integer not null default 0,next_attempt_at timestamptz not null default now(),lease uuid,leased_at timestamptz,
 last_error_code text check(length(last_error_code)<=50),sent_at timestamptz,
 check((channel='email' and subscription_id is null) or (channel='push' and subscription_id is not null))
);
create unique index delivery_dedupe on messaging_private.notification_deliveries(notification_id,channel,coalesce(subscription_id,'00000000-0000-0000-0000-000000000000'::uuid));
create index delivery_pending on messaging_private.notification_deliveries(next_attempt_at,id) where status in ('pending','retry','processing');
create table messaging_private.job_runs (
 id bigint generated always as identity primary key,started_at timestamptz not null default now(),finished_at timestamptz,
 homes_processed integer not null default 0,error_count integer not null default 0,last_error_code text
);
create table messaging_private.home_jobs (
 home_id uuid primary key references public.homes on delete cascade,last_run_at timestamptz not null default '-infinity'
);
do $$ declare t text;begin
 foreach t in array array['notification_preferences','notifications','push_subscriptions'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop;
 foreach t in array array['notification_deliveries','job_runs','home_jobs'] loop
 execute format('alter table messaging_private.%I enable row level security',t);
 execute format('revoke all on messaging_private.%I from public,anon,authenticated',t);
 end loop;
end $$;
create policy own_preferences on public.notification_preferences for select to authenticated using(user_id=auth.uid());
create policy own_notifications on public.notifications for select to authenticated using(user_id=auth.uid() and visible and invalidated_at is null and public.is_home_member(home_id));
create policy own_push on public.push_subscriptions for select to authenticated using(user_id=auth.uid());

create function public.save_notification_preferences(group_name text,app_enabled boolean,email_enabled boolean,push_enabled boolean,offsets integer[],expected_version integer) returns void
language plpgsql security definer set search_path='' as $$
declare v integer;
begin
 if auth.uid() is null then raise exception 'unauthorized';end if;
 perform 1 from public.profiles where id=auth.uid() for update;
 if group_name is null or group_name not in ('tasks','reservations','activities','expenses','community','chat') or app_enabled is null or email_enabled is null or push_enabled is null or offsets is null or not offsets <@ array[15,60,1440] or cardinality(offsets)>3 or cardinality(offsets)<>(select count(distinct x) from unnest(offsets) x) then raise exception 'invalid_preferences';end if;
 select version into v from public.notification_preferences where user_id=auth.uid() and category=group_name;
 if expected_version is null or coalesce(v,0)<>expected_version then raise exception 'stale_version';end if;
 insert into public.notification_preferences(user_id,category,in_app,email,push,reminder_minutes) values(auth.uid(),group_name,app_enabled,email_enabled,push_enabled,offsets)
 on conflict(user_id,category) do update set in_app=app_enabled,email=email_enabled,push=push_enabled,reminder_minutes=offsets,version=notification_preferences.version+1;
end $$;
create function public.mark_notifications_read(item uuid default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'unauthorized';end if;
 update public.notifications set read_at=now() where user_id=auth.uid() and visible and invalidated_at is null and read_at is null and public.is_home_member(home_id) and (item is null or id=item);
end $$;
create function public.save_push_subscription(push_endpoint text,public_key text,auth_secret text,device_label text default '') returns uuid language plpgsql security definer set search_path='' as $$
declare item uuid;owner_id uuid;
begin
 if auth.uid() is null then raise exception 'unauthorized';end if;
 perform 1 from public.profiles where id=auth.uid() for update;
 select id,user_id into item,owner_id from public.push_subscriptions where endpoint=push_endpoint;
 if found and owner_id<>auth.uid() then raise exception 'subscription_conflict';end if;
 if not exists(select 1 from public.push_subscriptions where id=item and active) and (select count(*) from public.push_subscriptions where user_id=auth.uid() and active)>=10 then raise exception 'rate_limited';end if;
 insert into public.push_subscriptions(user_id,endpoint,p256dh,auth_key,label) values(auth.uid(),push_endpoint,public_key,auth_secret,device_label)
 on conflict(endpoint) do update set p256dh=public_key,auth_key=auth_secret,label=device_label,active=true,updated_at=now() returning id into item;
 return item;
end $$;
create function public.revoke_push_subscription(item uuid default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'unauthorized';end if;
 update public.push_subscriptions set active=false,updated_at=now() where user_id=auth.uid() and (item is null or id=item);
end $$;

-- Never accepts an author/title/body/URL from a caller. In particular ratings are generic.
create function messaging_private.emit_notice(target uuid,recipient uuid,group_name text,event_name text,source_name text,item uuid,revision text,event_time timestamptz default null,minutes_before integer default null) returns void
language plpgsql security definer set search_path='' as $$
declare pref public.notification_preferences;lang text;heading text;notice uuid;route text;key text;
begin
 if not exists(select 1 from public.home_members where home_id=target and user_id=recipient and active) then return;end if;
 select * into pref from public.notification_preferences where user_id=recipient and category=group_name;
 if not coalesce(pref.in_app,true) and not coalesce(pref.email,false) and not coalesce(pref.push,false) then return;end if;
 select locale into lang from public.profiles where id=recipient;
 heading:=case event_name
 when 'chat_message' then case when lang='en' then 'New message' else 'Nuevo mensaje' end
 when 'rating_received' then case when lang='en' then 'New rating' else 'Nueva valoración' end
 when 'punishment_created' then case when lang='en' then 'New consequence' else 'Nuevo castigo' end
 when 'punishment_updated' then case when lang='en' then 'Consequence updated' else 'Castigo actualizado' end
 when 'task_assigned' then case when lang='en' then 'Task assignment' else 'Asignación de tarea' end
 when 'expense_added' then case when lang='en' then 'Expense updated' else 'Gasto actualizado' end
 when 'settlement' then case when lang='en' then 'Payment recorded' else 'Pago registrado' end
 when 'recurring_pending' then case when lang='en' then 'Recurring expense needs review' else 'Gasto recurrente pendiente' end
 when 'reservation_changed' then case when lang='en' then 'Reservation updated' else 'Reserva actualizada' end
 when 'reservation_cancelled' then case when lang='en' then 'Reservation cancelled' else 'Reserva cancelada' end
 when 'activity_cancelled' then case when lang='en' then 'Activity cancelled' else 'Actividad cancelada' end
 when 'activity_changed' then case when lang='en' then 'Activity updated' else 'Actividad actualizada' end
 when 'reminder' then case when lang='en' then 'Upcoming event' else 'Recordatorio próximo' end
 else null end;
 if heading is null then raise exception 'invalid_notice';end if;
 route:=case group_name when 'tasks' then '/organization' when 'reservations' then '/organization/reservations' when 'activities' then '/community/activities' when 'community' then '/community' when 'expenses' then '/expenses' when 'chat' then '/chat' else null end;
 if route is null then raise exception 'invalid_notice';end if;
 key:=event_name||':'||source_name||':'||item::text||':'||revision||':'||coalesce(minutes_before::text,'');
 insert into public.notifications(user_id,home_id,category,event_type,title,body,target_url,source_table,source_id,source_version,event_at,reminder_minutes,visible,dedupe_key)
 values(recipient,target,group_name,event_name,heading,
 case when minutes_before is not null then case when lang='en' then 'Starts in about '||minutes_before||' minutes.' else 'Comienza en unos '||minutes_before||' minutos.' end
 else case when lang='en' then 'Open RoomieHub to view the details.' else 'Abre RoomieHub para ver los detalles.' end end,
 '/homes/'||target::text||route,source_name,item,revision,event_time,minutes_before,coalesce(pref.in_app,true),key)
 on conflict(user_id,dedupe_key) do nothing returning id into notice;
 if notice is null then return;end if;
 if coalesce(pref.email,false) then insert into messaging_private.notification_deliveries(notification_id,channel) values(notice,'email');end if;
 if coalesce(pref.push,false) then
  insert into messaging_private.notification_deliveries(notification_id,channel,subscription_id) select notice,'push',id from public.push_subscriptions where user_id=recipient and active;
 end if;
end $$;

create function messaging_private.source_notice() returns trigger language plpgsql security definer set search_path='' as $$
declare person uuid;event_name text;
begin
 if tg_table_name='chat_messages' then
  for person in select user_id from public.home_members where home_id=new.home_id and active and user_id<>new.author_user_id loop
   perform messaging_private.emit_notice(new.home_id,person,'chat','chat_message','chat_messages',new.id,'1');end loop;
 elsif tg_table_name='ratings' then
  perform messaging_private.emit_notice(new.home_id,new.target_user_id,'community','rating_received','ratings',new.id,'1');
 elsif tg_table_name='punishments' then
  event_name:=case when tg_op='INSERT' then 'punishment_created' else 'punishment_updated' end;
  perform messaging_private.emit_notice(new.home_id,new.user_id,'community',event_name,'punishments',new.id,new.version::text);
 elsif tg_table_name='chore_instances' then
  if new.completed_at is null and new.cancelled_at is null and not new.assignment_blocked and (tg_op='INSERT' or new.assignee_id is distinct from old.assignee_id) then
   perform messaging_private.emit_notice(new.home_id,new.assignee_id,'tasks','task_assigned','chore_instances',new.id,new.assignee_id::text);end if;
 elsif tg_table_name='expenses' then
  if new.deleted_at is null then perform messaging_private.emit_notice(new.home_id,new.payer,'expenses','expense_added','expenses',new.id,new.version::text);end if;
 elsif tg_table_name='expense_splits' then
  perform messaging_private.emit_notice(new.home_id,new.user_id,'expenses','expense_added','expenses',new.expense_id,(select version::text from public.expenses where id=new.expense_id));
 elsif tg_table_name='settlements' then
  perform messaging_private.emit_notice(new.home_id,new.from_user,'expenses','settlement','settlements',new.id,'1');
  perform messaging_private.emit_notice(new.home_id,new.to_user,'expenses','settlement','settlements',new.id,'1');
 elsif tg_table_name='recurring_expense_instances' then
  if new.status='pending' and new.recurrence_kind='variable' then
   for person in select user_id from public.home_members where home_id=new.home_id and active and (user_id=(new.template->>'payer')::uuid or user_id in(select (x->>'user_id')::uuid from jsonb_array_elements(new.template->'participants') x)) loop
    perform messaging_private.emit_notice(new.home_id,person,'expenses','recurring_pending','recurring_expense_instances',new.id,'1');end loop;
  end if;
 elsif tg_table_name='reservations' then
  perform messaging_private.emit_notice(new.home_id,new.responsible_id,'reservations',case when new.cancelled_at is null then 'reservation_changed' else 'reservation_cancelled' end,'reservations',new.id,new.version::text);
 elsif tg_table_name='activities' then
  for person in select user_id from public.activity_members where activity_id=new.id and attending loop
   perform messaging_private.emit_notice(new.home_id,person,'activities',case when new.cancelled_at is null then 'activity_changed' else 'activity_cancelled' end,'activities',new.id,new.version::text);end loop;
 end if;
 return new;
end $$;
create trigger chat_notice after insert on public.chat_messages for each row execute function messaging_private.source_notice();
create trigger rating_notice after insert on public.ratings for each row execute function messaging_private.source_notice();
create trigger punishment_notice after insert or update on public.punishments for each row execute function messaging_private.source_notice();
create trigger task_notice after insert or update of assignee_id on public.chore_instances for each row execute function messaging_private.source_notice();
create trigger expense_payer_notice after insert or update on public.expenses for each row execute function messaging_private.source_notice();
create trigger expense_notice after insert on public.expense_splits for each row execute function messaging_private.source_notice();
create trigger settlement_notice after insert on public.settlements for each row execute function messaging_private.source_notice();
create trigger recurring_notice after insert on public.recurring_expense_instances for each row execute function messaging_private.source_notice();
create trigger reservation_notice after insert or update on public.reservations for each row execute function messaging_private.source_notice();
create trigger activity_notice after update on public.activities for each row execute function messaging_private.source_notice();

-- Revalidation is shared by inbox invalidation and every external delivery attempt.
create function messaging_private.notice_valid(n public.notifications,at_time timestamptz default now()) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare valid boolean:=false;starts timestamptz;
begin
 if not exists(select 1 from public.home_members where home_id=n.home_id and user_id=n.user_id and active) then return false;end if;
 case n.source_table
 when 'chat_messages' then select deleted_at is null into valid from public.chat_messages where id=n.source_id and home_id=n.home_id;
 when 'ratings' then select deleted_at is null and target_user_id=n.user_id into valid from public.ratings where id=n.source_id and home_id=n.home_id;
 when 'punishments' then select user_id=n.user_id into valid from public.punishments where id=n.source_id and home_id=n.home_id;
 when 'chore_instances' then select completed_at is null and cancelled_at is null and not assignment_blocked and assignee_id=n.user_id,deadline_at into valid,starts from public.chore_instances where id=n.source_id and home_id=n.home_id;
 when 'reservations' then select (cancelled_at is null or n.event_type='reservation_cancelled') and responsible_id=n.user_id,starts_at into valid,starts from public.reservations where id=n.source_id and home_id=n.home_id;
 when 'activities' then select (cancelled_at is null or n.event_type='activity_cancelled') and exists(select 1 from public.activity_members where activity_id=a.id and user_id=n.user_id and attending),starts_at into valid,starts from public.activities a where id=n.source_id and home_id=n.home_id;
 when 'expenses' then select deleted_at is null and (payer=n.user_id or exists(select 1 from public.expense_splits where expense_id=e.id and user_id=n.user_id)) into valid from public.expenses e where id=n.source_id and home_id=n.home_id;
 when 'settlements' then select n.user_id in (from_user,to_user) into valid from public.settlements where id=n.source_id and home_id=n.home_id;
 when 'recurring_expense_instances' then select status='pending' and ((template->>'payer')::uuid=n.user_id or exists(select 1 from jsonb_array_elements(template->'participants') x where (x->>'user_id')::uuid=n.user_id)) into valid from public.recurring_expense_instances where id=n.source_id and home_id=n.home_id;
 else return false;
 end case;
 if n.event_type='reminder' then return coalesce(valid,false) and starts=n.event_at and starts>at_time;end if;
 return coalesce(valid,false);
end $$;

create function messaging_private.remind_home(target uuid,at_time timestamptz) returns integer language plpgsql security definer set search_path='' as $$
declare e record;offset_minutes integer;made integer:=0;
begin
 for e in
  select 'tasks' category,'chore_instances' source,id,assignee_id person,deadline_at starts from public.chore_instances where home_id=target and completed_at is null and cancelled_at is null and not assignment_blocked and deadline_at>at_time and deadline_at<=at_time+interval '1 day'
  union all select 'reservations','reservations',id,responsible_id,starts_at from public.reservations where home_id=target and cancelled_at is null and starts_at>at_time and starts_at<=at_time+interval '1 day'
  union all select 'activities','activities',a.id,m.user_id,a.starts_at from public.activities a join public.activity_members m on m.activity_id=a.id and m.attending where a.home_id=target and a.cancelled_at is null and a.starts_at>at_time and a.starts_at<=at_time+interval '1 day'
 loop
  foreach offset_minutes in array coalesce((select reminder_minutes from public.notification_preferences where user_id=e.person and category=e.category),array[60]) loop
   -- Ten-minute catch-up window, never after the actual event; longer outages do not spam.
   if e.starts-offset_minutes*interval '1 minute'<=at_time and e.starts-offset_minutes*interval '1 minute'>at_time-interval '10 minutes' then
    perform messaging_private.emit_notice(target,e.person,e.category,'reminder',e.source,e.id,extract(epoch from e.starts)::text,e.starts,offset_minutes);
    made:=made+1;
   end if;
  end loop;
 end loop;
 update public.notifications n set invalidated_at=at_time where home_id=target and invalidated_at is null and not messaging_private.notice_valid(n,at_time);
 return made;
end $$;

-- Owner/cron only. Service role can invoke the wrapper; normal clients cannot run a global job.
create function messaging_private.run_jobs() returns jsonb language plpgsql security definer set search_path='' as $$
declare h record;person uuid;old_claim text;run_id bigint;processed integer:=0;errors integer:=0;code text;
begin
 if not pg_try_advisory_xact_lock(620260916) then return jsonb_build_object('busy',true);end if;
 insert into messaging_private.job_runs default values returning id into run_id;
 old_claim:=current_setting('request.jwt.claim.sub',true);
 insert into messaging_private.home_jobs(home_id) select id from public.homes on conflict do nothing;
 for h in select j.home_id from messaging_private.home_jobs j order by j.last_run_at,j.home_id limit 100 loop
  begin
   perform 1 from public.homes where id=h.home_id for update skip locked;
   if not found then continue;end if;
   select user_id into person from public.home_members where home_id=h.home_id and active order by user_id limit 1;
   if person is not null then
    -- Reuse authorized domain RPCs without relaxing their public permission checks.
    perform set_config('request.jwt.claim.sub',person::text,true);
    perform public.ensure_current_chores(h.home_id);
    perform public.reconcile_chore_assignments(h.home_id);
    perform public.generate_recurring_expenses(h.home_id);
    perform public.reconcile_community(h.home_id);
    perform messaging_private.remind_home(h.home_id,now());
   end if;
   update messaging_private.home_jobs set last_run_at=now() where home_id=h.home_id;
   processed:=processed+1;
  exception when others then
   errors:=errors+1;get stacked diagnostics code=returned_sqlstate;
   update messaging_private.home_jobs set last_run_at=now() where home_id=h.home_id;
  end;
 end loop;
 perform set_config('request.jwt.claim.sub',coalesce(old_claim,''),true);
 delete from messaging_private.rate_limits where window_at<now()-interval '1 day';
 delete from messaging_private.job_runs where started_at<now()-interval '30 days';
 update messaging_private.job_runs set finished_at=now(),homes_processed=processed,error_count=errors,last_error_code=code where id=run_id;
 return jsonb_build_object('homes',processed,'errors',errors);
end $$;
create function public.run_notification_jobs() returns jsonb language sql security definer set search_path='' as $$ select messaging_private.run_jobs(); $$;

create function public.claim_notification_deliveries(channels text[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare d messaging_private.notification_deliveries;n public.notifications;p public.notification_preferences;output jsonb:='[]';token uuid;
begin
 for d in select * from messaging_private.notification_deliveries where channel=any(channels) and
 ((status in ('pending','retry') and next_attempt_at<=now()) or (status='processing' and leased_at<now()-interval '5 minutes'))
 order by next_attempt_at,id limit 30 for update skip locked loop
  select * into n from public.notifications where id=d.notification_id;
  select * into p from public.notification_preferences where user_id=n.user_id and category=n.category;
  if d.attempts>=5 then update messaging_private.notification_deliveries set status='failed',last_error_code='attempt_limit' where id=d.id;continue;end if;
  if not messaging_private.notice_valid(n) or n.invalidated_at is not null or
    (d.channel='email' and not coalesce(p.email,false)) or (d.channel='push' and (not coalesce(p.push,false) or not exists(select 1 from public.push_subscriptions where id=d.subscription_id and active))) then
   update messaging_private.notification_deliveries set status='cancelled' where id=d.id;continue;
  end if;
  token:=gen_random_uuid();
  update messaging_private.notification_deliveries set status='processing',attempts=attempts+1,lease=token,leased_at=now() where id=d.id;
  output:=output||jsonb_build_array(jsonb_build_object('id',d.id,'lease',token,'channel',d.channel,'user_id',n.user_id,'notification_id',n.id,'event_at',n.event_at,'title',n.title,'body',n.body,'url',n.target_url,
   'subscription',case when d.channel='push' then (select jsonb_build_object('endpoint',endpoint,'keys',jsonb_build_object('p256dh',p256dh,'auth',auth_key)) from public.push_subscriptions where id=d.subscription_id) else null end));
 end loop;
 return output;
end $$;
create function public.notification_delivery_valid(item uuid,lease_token uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from messaging_private.notification_deliveries d join public.notifications n on n.id=d.notification_id
 join public.notification_preferences p on p.user_id=n.user_id and p.category=n.category
 where d.id=item and d.lease=lease_token and d.status='processing' and n.invalidated_at is null and messaging_private.notice_valid(n)
 and case when d.channel='email' then p.email else p.push and exists(select 1 from public.push_subscriptions where id=d.subscription_id and active) end);
$$;
create function public.finish_notification_delivery(item uuid,lease_token uuid,outcome text,error_code text default null) returns void language plpgsql security definer set search_path='' as $$
declare d messaging_private.notification_deliveries;
begin
 if outcome not in ('sent','retry','failed','expired','cancelled') or (error_code is not null and error_code !~ '^[a-z0-9_]{1,50}$') then raise exception 'invalid_delivery';end if;
 select * into d from messaging_private.notification_deliveries where id=item and lease=lease_token and status='processing' for update;
 if not found then return;end if;
 if outcome='expired' and d.subscription_id is not null then update public.push_subscriptions set active=false,updated_at=now() where id=d.subscription_id;end if;
 update messaging_private.notification_deliveries set status=case when outcome='expired' then 'failed' when outcome='retry' and attempts>=5 then 'failed' else outcome end,
 sent_at=case when outcome='sent' then now() else null end,last_error_code=error_code,next_attempt_at=now()+least(60,power(2,d.attempts))::integer*interval '1 minute',lease=null where id=item;
end $$;
create function public.notification_job_status() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('last_run',(select to_jsonb(r) from messaging_private.job_runs r order by id desc limit 1),'pending',(select count(*) from messaging_private.notification_deliveries where status in ('pending','retry','processing')),'failed',(select count(*) from messaging_private.notification_deliveries where status='failed'));
$$;
revoke all on all functions in schema messaging_private from public,anon,authenticated;
revoke all on function public.save_notification_preferences(text,boolean,boolean,boolean,integer[],integer),public.mark_notifications_read(uuid),public.save_push_subscription(text,text,text,text),public.revoke_push_subscription(uuid) from public,anon;
grant execute on function public.save_notification_preferences(text,boolean,boolean,boolean,integer[],integer),public.mark_notifications_read(uuid),public.save_push_subscription(text,text,text,text),public.revoke_push_subscription(uuid) to authenticated;
revoke all on function public.run_notification_jobs(),public.claim_notification_deliveries(text[]),public.notification_delivery_valid(uuid,uuid),public.finish_notification_delivery(uuid,uuid,text,text),public.notification_job_status() from public,anon,authenticated;
grant execute on function public.run_notification_jobs(),public.claim_notification_deliveries(text[]),public.notification_delivery_valid(uuid,uuid),public.finish_notification_delivery(uuid,uuid,text,text),public.notification_job_status() to service_role;
alter publication supabase_realtime add table public.notifications;
commit;


-- Production scheduler. Supabase PostgreSQL extensions; not supported by PGlite.
begin;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;
create function messaging_private.dispatch_deliveries() returns bigint language plpgsql security definer set search_path='' as $$
declare worker_url text;worker_token text;request_id bigint;
begin
 select decrypted_secret into worker_url from vault.decrypted_secrets where name='roomiehub_worker_url';
 select decrypted_secret into worker_token from vault.decrypted_secrets where name='roomiehub_worker_token';
 -- In-app jobs are independent of optional external transport configuration.
 if worker_url is null or worker_token is null then return null;end if;
 if worker_url !~ '^https://[^/@[:space:]]+/api/jobs/notifications$' or length(worker_token)<32 then raise exception 'invalid_worker_configuration';end if;
 select net.http_post(url:=worker_url,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||worker_token),body:='{}'::jsonb,timeout_milliseconds:=120000) into request_id;
 return request_id;
end $$;
revoke all on function messaging_private.dispatch_deliveries() from public,anon,authenticated,service_role;
select cron.schedule('roomiehub-domain-jobs','*/5 * * * *',$job$select messaging_private.run_jobs();$job$);
select cron.schedule('roomiehub-deliveries','*/5 * * * *',$job$select messaging_private.dispatch_deliveries();$job$);
-- Scheduler history is operational metadata, bounded to thirty days.
select cron.schedule('roomiehub-cron-history','17 3 * * *',$job$delete from cron.job_run_details where end_time<now()-interval '30 days' and jobid in(select jobid from cron.job where jobname like 'roomiehub-%');$job$);
commit;
