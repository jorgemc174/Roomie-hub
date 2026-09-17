-- Phase 5. Private authors/audit are never exposed through PostgREST or Realtime.
begin;
create schema community_private;
revoke all on schema community_private from public,anon,authenticated;
create table public.rating_reasons (
 id uuid primary key, home_id uuid not null references public.homes on delete cascade,
 kind text not null check(kind in ('positive','negative')), name text not null check(length(trim(name)) between 1 and 120),
 requires_text boolean not null default false, active boolean not null default true, seed_key text,
 version integer not null default 1, unique(home_id,id),unique(home_id,seed_key)
);
-- Deliberately no author/editor column or relationship on this public table.
create table public.ratings (
 id uuid primary key,home_id uuid not null references public.homes on delete cascade,
 target_user_id uuid not null,target_name text not null,kind text not null check(kind in ('positive','negative')),
 initial_kind text not null check(initial_kind in ('positive','negative')),
 reason_id uuid,reason_name text not null,custom_text text not null default '' check(length(custom_text)<=2000),
 is_anonymous boolean not null default false,source text not null check(source in ('manual','task_overdue','system')),
 source_id uuid,overdue_day integer,attachment_path text,
 created_at timestamptz not null default now(),effective_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 deleted_at timestamptz,version integer not null default 1,
 unique(home_id,id),unique(source_id,overdue_day),
 foreign key(home_id,target_user_id) references public.home_members(home_id,user_id) deferrable initially deferred,
 foreign key(home_id,reason_id) references public.rating_reasons(home_id,id),
 foreign key(home_id,source_id) references public.chore_instances(home_id,id),
 check((source='manual' and reason_id is not null and source_id is null and overdue_day is null) or
       (source='task_overdue' and kind='negative' and reason_id is null and source_id is not null and overdue_day>0 and not is_anonymous) or
       (source='system' and reason_id is null and source_id is null and overdue_day is null))
);
create index ratings_home_person on public.ratings(home_id,target_user_id,effective_at,id);
create table community_private.rating_authors (
 rating_id uuid primary key references public.ratings on delete cascade,home_id uuid not null references public.homes on delete cascade,
 author_id uuid not null references public.profiles,author_name text not null,create_request jsonb not null
);
create table community_private.rating_audit (
 id bigint generated always as identity primary key,rating_id uuid not null references public.ratings on delete cascade,
 home_id uuid not null references public.homes on delete cascade,actor uuid references public.profiles,
 recorded_at timestamptz not null default now(),snapshot jsonb not null
);
create table public.rating_redemptions (
 id uuid primary key default gen_random_uuid(),home_id uuid not null references public.homes on delete cascade,
 user_id uuid not null,positive_ids uuid[] not null check(cardinality(positive_ids)=3),negative_id uuid references public.ratings,
 created_at timestamptz not null default now(),revoked_at timestamptz,
 foreign key(home_id,user_id) references public.home_members(home_id,user_id) deferrable initially deferred
);
create unique index redemption_live_triplet on public.rating_redemptions(home_id,user_id,positive_ids) where revoked_at is null;
create unique index redemption_live_negative on public.rating_redemptions(negative_id) where revoked_at is null and negative_id is not null;
create table public.punishments (
 id uuid primary key default gen_random_uuid(),home_id uuid not null references public.homes on delete cascade,
 user_id uuid not null,user_name text not null,threshold integer not null check(threshold>0 and threshold%5=0),
 severity text not null check(severity in ('light','heavy')),description text not null default '' check(length(description)<=2000),
 triggered_at timestamptz not null default now(),completed_at timestamptz,completed_by uuid references public.profiles,completed_by_name text,
 version integer not null default 1,unique(home_id,user_id,threshold),
 foreign key(home_id,user_id) references public.home_members(home_id,user_id) deferrable initially deferred,
 check(severity=case when threshold%10=0 then 'heavy' else 'light' end),
 check((completed_at is null and completed_by is null and completed_by_name is null) or (completed_at is not null and completed_by is not null and completed_by_name is not null))
);
create table community_private.rating_uploads (
 path text primary key,home_id uuid not null references public.homes on delete cascade,rating_id uuid not null references public.ratings on delete cascade,
 actor uuid not null references public.profiles,created_at timestamptz not null default now()
);
create table community_private.penalty_progress (
 instance_id uuid primary key references public.chore_instances on delete cascade,last_day integer not null default 0
);
create table community_private.penalty_days (
 instance_id uuid not null references public.chore_instances on delete cascade,day_number integer not null,
 responsible_id uuid,decision text not null check(decision in ('issued','blocked','inactive')),primary key(instance_id,day_number)
);
do $$ declare t text;begin
 foreach t in array array['rating_reasons','ratings','rating_redemptions','punishments'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy member_read on public.%I for select to authenticated using(public.is_home_member(home_id))',t);
 end loop;
 foreach t in array array['rating_authors','rating_audit','rating_uploads','penalty_progress','penalty_days'] loop
 execute format('alter table community_private.%I enable row level security',t);
 execute format('revoke all on community_private.%I from public,anon,authenticated',t);
 end loop;
end $$;

-- Deterministic allocation reconstructed from live ratings. Revoked allocations remain auditable.
-- Triplets are consumed even without negatives: a null negative is a pending compensation credit.
create function community_private.reconcile_person(target uuid,person uuid) returns void language plpgsql security definer set search_path='' as $$
declare positives uuid[];negatives uuid[];triplet uuid[];neg uuid;n integer;idx integer;effective integer;nm text;
begin
 select coalesce(array_agg(id order by effective_at,id),'{}') into positives from public.ratings where home_id=target and target_user_id=person and deleted_at is null and kind='positive';
 select coalesce(array_agg(id order by effective_at,id),'{}') into negatives from public.ratings where home_id=target and target_user_id=person and deleted_at is null and kind='negative';
 n:=cardinality(positives)/3;
 -- First revoke mismatches so a negative can safely be reassigned between corrected triplets.
 update public.rating_redemptions r set revoked_at=now() where home_id=target and user_id=person and revoked_at is null
 and not exists(select 1 from generate_series(1,n) k where r.positive_ids=positives[(k*3-2):(k*3)] and r.negative_id is not distinct from negatives[k]);
 for idx in 1..n loop
 triplet:=positives[(idx*3-2):(idx*3)];neg:=negatives[idx];
 insert into public.rating_redemptions(home_id,user_id,positive_ids,negative_id) values(target,person,triplet,neg)
 on conflict(home_id,user_id,positive_ids) where revoked_at is null do nothing;
 end loop;
 effective:=greatest(0,cardinality(negatives)-n);
 if exists(select 1 from public.home_members where home_id=target and user_id=person and active) then
 select name into nm from public.profiles where id=person;
 insert into public.punishments(home_id,user_id,user_name,threshold,severity)
 select target,person,nm,k,case when k%10=0 then 'heavy' else 'light' end from generate_series(5,effective,5) k
 on conflict(home_id,user_id,threshold) do nothing;
 end if;
end $$;
create function public.community_balances(target uuid) returns table(user_id uuid,user_name text,active boolean,positive_history bigint,negative_history bigint,positive_available bigint,positive_consumed bigint,negative_effective bigint,credits bigint,pending_punishments bigint)
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_home_member(target) then raise exception 'unauthorized'; end if;
 return query select m.user_id,
 case when m.active then p.name else coalesce((select r.target_name from public.ratings r where r.home_id=target and r.target_user_id=m.user_id order by r.effective_at desc,r.id limit 1),'') end,
 m.active,
 (select count(*) from public.ratings r where r.home_id=target and r.target_user_id=m.user_id and r.initial_kind='positive'),
 (select count(*) from public.ratings r where r.home_id=target and r.target_user_id=m.user_id and r.initial_kind='negative'),
 (select count(*) from public.ratings r where r.home_id=target and r.target_user_id=m.user_id and r.kind='positive' and r.deleted_at is null)-3*(select count(*) from public.rating_redemptions d where d.home_id=target and d.user_id=m.user_id and d.revoked_at is null),
 3*(select count(*) from public.rating_redemptions d where d.home_id=target and d.user_id=m.user_id and d.revoked_at is null),
 (select count(*) from public.ratings r where r.home_id=target and r.target_user_id=m.user_id and r.kind='negative' and r.deleted_at is null)-(select count(*) from public.rating_redemptions d where d.home_id=target and d.user_id=m.user_id and d.revoked_at is null and d.negative_id is not null),
 (select count(*) from public.rating_redemptions d where d.home_id=target and d.user_id=m.user_id and d.revoked_at is null and d.negative_id is null),
 (select count(*) from public.punishments x where x.home_id=target and x.user_id=m.user_id and x.completed_at is null)
 from public.home_members m left join public.profiles p on p.id=m.user_id and m.active where m.home_id=target;
end $$;
-- Only this checked RPC may return identities. No join relation exists on public.ratings.
create function public.rating_author_labels(target uuid,items uuid[]) returns table(rating_id uuid,author_id uuid,author_name text,is_mine boolean)
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_home_member(target) then raise exception 'unauthorized'; end if;
 if cardinality(items)>500 then raise exception 'invalid_limit'; end if;
 return query select r.id,case when not r.is_anonymous or a.author_id=auth.uid() then a.author_id end,
 case when not r.is_anonymous or a.author_id=auth.uid() then a.author_name end,coalesce(a.author_id=auth.uid(),false)
 from public.ratings r left join community_private.rating_authors a on a.rating_id=r.id where r.home_id=target and r.id=any(items);
end $$;
create function public.save_rating_reason(target uuid,item uuid,expected_version integer,label text,sign text,needs_text boolean,enabled boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.rating_reasons;
begin
 perform public.organization_lock(target);
 if item is null or expected_version is null then raise exception 'invalid_reason'; end if;
 select * into r from public.rating_reasons where id=item;
 if found then
 if r.home_id<>target then raise exception 'not_found'; end if;
 if expected_version=0 and row(r.name,r.kind,r.requires_text,r.active) is not distinct from row(trim(label),sign,needs_text,enabled) then return item; end if;
 if r.version<>expected_version then raise exception 'stale_version'; end if;
 update public.rating_reasons set name=trim(label),kind=sign,requires_text=needs_text,active=enabled,version=version+1 where id=item;
 else
 if expected_version<>0 then raise exception 'not_found'; end if;
 insert into public.rating_reasons(id,home_id,name,kind,requires_text,active) values(item,target,trim(label),sign,needs_text,enabled);
 end if;return item;
end $$;
create function public.initialize_rating_reasons(target uuid,language_code text default 'es') returns void language plpgsql security definer set search_path='' as $$
declare labels text[];k integer;
begin
 perform public.organization_lock(target);
 labels:=case when language_code='en' then array['Helped clean','Helped a housemate','Bought something needed','Took initiative','Other','Did not wash dishes','Left shared areas dirty','Made too much noise','Did not complete a chore','Other'] else array['Ayudó a limpiar','Ayudó a otro compañero','Compró algo necesario','Tomó iniciativa','Otro','No fregó los platos','Dejó una zona común sucia','Hizo demasiado ruido','No cumplió una tarea','Otro'] end;
 for k in 1..10 loop
 insert into public.rating_reasons(id,home_id,name,kind,requires_text,seed_key) values(gen_random_uuid(),target,labels[k],case when k<=5 then 'positive' else 'negative' end,k in (5,10),'default-'||k) on conflict(home_id,seed_key) do nothing;
 end loop;
end $$;
create function public.save_rating(target uuid,item uuid,expected_version integer,person uuid,reason uuid,notes text,anonymous boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare old public.ratings;why public.rating_reasons;nm text;payload jsonb;creator uuid;
begin
 perform public.organization_lock(target);
 if item is null or expected_version is null or notes is null or anonymous is null or length(notes)>2000 then raise exception 'invalid_rating'; end if;
 payload:=jsonb_build_object('person',person,'reason',reason,'notes',notes,'anonymous',anonymous);
 select * into old from public.ratings where id=item;
 if found then
 if old.home_id<>target then raise exception 'not_found'; end if;
 select author_id into creator from community_private.rating_authors where rating_id=item;
 if expected_version=0 then
 if creator=auth.uid() and exists(select 1 from community_private.rating_authors where rating_id=item and create_request=payload) then return item; end if;
 raise exception 'idempotency_conflict'; end if;
 if old.source<>'manual' or old.deleted_at is not null then raise exception 'locked_rating'; end if;
 if old.version<>expected_version then raise exception 'stale_version'; end if;
 if person is distinct from old.target_user_id then raise exception 'immutable_recipient'; end if;
 if old.is_anonymous and not anonymous and creator<>auth.uid() then raise exception 'anonymous_locked'; end if;
 else
 if expected_version<>0 then raise exception 'not_found'; end if;
 if person=auth.uid() then raise exception 'self_rating'; end if;
 if not exists(select 1 from public.home_members where home_id=target and user_id=person and active) then raise exception 'invalid_member'; end if;
 end if;
 select * into why from public.rating_reasons where home_id=target and id=reason and active;
 if not found or (why.requires_text and length(trim(notes))=0) then raise exception 'invalid_reason'; end if;
 if old.id is null then
 select name into nm from public.profiles where id=person;
 insert into public.ratings(id,home_id,target_user_id,target_name,kind,initial_kind,reason_id,reason_name,custom_text,is_anonymous,source)
 values(item,target,person,nm,why.kind,why.kind,reason,why.name,trim(notes),anonymous,'manual');
 insert into community_private.rating_authors(rating_id,home_id,author_id,author_name,create_request) select item,target,auth.uid(),name,payload from public.profiles where id=auth.uid();
 else
 update public.ratings set kind=why.kind,reason_id=reason,reason_name=why.name,custom_text=trim(notes),is_anonymous=anonymous,version=version+1,updated_at=now() where id=item;
 end if;
 insert into community_private.rating_audit(rating_id,home_id,actor,snapshot) select item,target,auth.uid(),to_jsonb(r) from public.ratings r where id=item;
 perform community_private.reconcile_person(target,person);return item;
end $$;
create function public.delete_rating(target uuid,item uuid,expected_version integer) returns void language plpgsql security definer set search_path='' as $$
declare r public.ratings;
begin
 perform public.organization_lock(target);select * into r from public.ratings where home_id=target and id=item;
 if not found then raise exception 'not_found'; end if;
 if r.source<>'manual' then raise exception 'locked_rating'; end if;
 if r.deleted_at is not null then return; end if;
 if expected_version is null or r.version<>expected_version then raise exception 'stale_version'; end if;
 update public.ratings set deleted_at=now(),updated_at=now(),version=version+1 where id=item;
 insert into community_private.rating_audit(rating_id,home_id,actor,snapshot) select item,target,auth.uid(),to_jsonb(x) from public.ratings x where id=item;
 perform community_private.reconcile_person(target,r.target_user_id);
end $$;
create function public.save_punishment(target uuid,item uuid,expected_version integer,notes text,finish boolean) returns void language plpgsql security definer set search_path='' as $$
declare p public.punishments;
begin
 perform public.organization_lock(target);select * into p from public.punishments where home_id=target and id=item;
 if not found then raise exception 'not_found'; end if;
 if expected_version is null or p.version<>expected_version then raise exception 'stale_version'; end if;
 if finish is null or notes is null or length(notes)>2000 or (finish and length(trim(notes))=0) then raise exception 'invalid_punishment'; end if;
 update public.punishments set description=trim(notes),version=version+1,
 completed_at=case when finish then coalesce(completed_at,now()) else completed_at end,
 completed_by=case when finish then coalesce(completed_by,auth.uid()) else completed_by end,
 completed_by_name=case when finish then coalesce(completed_by_name,(select name from public.profiles where id=auth.uid())) else completed_by_name end where id=item;
end $$;

-- Extend the existing assignment history with blocked/unblocked transitions, ordered even within one transaction.
alter table public.chore_assignment_events add column event_order bigint generated always as identity;
alter table public.chore_assignment_events add column blocked boolean not null default false;
alter table public.chore_assignment_events drop constraint chore_assignment_events_reason_check;
alter table public.chore_assignment_events add constraint chore_assignment_events_reason_check check(reason in ('generated','reassigned','blocked','unblocked'));
-- For legacy currently-blocked rows there is no historical blocking timeline. Conservatively exempt their unprocessed past.
insert into public.chore_assignment_events(home_id,instance_id,assignee_id,assignee_name,reason,blocked,created_at)
select home_id,id,assignee_id,assignee_name,'blocked',true,now() from public.chore_instances where assignment_blocked and cancelled_at is null;
insert into community_private.penalty_progress(instance_id,last_day)
select id,greatest(0,floor(extract(epoch from(now()-deadline_at))/86400)::integer) from public.chore_instances where assignment_blocked and deadline_at is not null and cancelled_at is null;
create function community_private.track_blocked() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.assignment_blocked is distinct from old.assignment_blocked then
 insert into public.chore_assignment_events(home_id,instance_id,assignee_id,assignee_name,reason,blocked) values(new.home_id,new.id,new.assignee_id,new.assignee_name,case when new.assignment_blocked then 'blocked' else 'unblocked' end,new.assignment_blocked);
 end if;return new;
end $$;
create trigger community_track_blocked after update of assignment_blocked on public.chore_instances for each row execute function community_private.track_blocked();
-- Internal cutoff only: callers cannot forge the current time. Bounded per call, not capped over lifetime.
create function community_private.issue_overdue(target uuid,cutoff timestamptz,only_instance uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare i public.chore_instances;lastday integer;due integer;k integer;boundary timestamptz;assignment public.chore_assignment_events;made integer:=0;processed integer:=0;decision text;person uuid;
begin
 for i in select * from public.chore_instances where home_id=target and deadline_at is not null and cancelled_at is null and (only_instance is null or id=only_instance) order by deadline_at,id loop
 due:=greatest(0,floor(extract(epoch from (least(cutoff,coalesce(i.completed_at,cutoff))-i.deadline_at))/86400)::integer);
 insert into community_private.penalty_progress(instance_id) values(i.id) on conflict do nothing;
 select last_day into lastday from community_private.penalty_progress where instance_id=i.id;
 for k in (lastday+1)..due loop
 if processed>=500 then return jsonb_build_object('created',made,'processed',processed,'more',true); end if;
 boundary:=i.deadline_at+k*interval '24 hours';
 select * into assignment from public.chore_assignment_events where instance_id=i.id and created_at<=boundary order by created_at desc,event_order desc limit 1;
 if not found then select * into assignment from public.chore_assignment_events where instance_id=i.id order by created_at,event_order limit 1; end if;
 person:=coalesce(assignment.assignee_id,i.assignee_id);
 decision:=case when coalesce(assignment.blocked,i.assignment_blocked) then 'blocked'
 when not exists(select 1 from public.home_members where home_id=target and user_id=person and active and joined_at<=boundary) then 'inactive' else 'issued' end;
 insert into community_private.penalty_days(instance_id,day_number,responsible_id,decision) values(i.id,k,person,decision) on conflict do nothing;
 if decision='issued' then
 insert into public.ratings(id,home_id,target_user_id,target_name,kind,initial_kind,reason_name,source,source_id,overdue_day,effective_at)
 values(gen_random_uuid(),target,person,coalesce(assignment.assignee_name,i.assignee_name),'negative','negative',i.task_name,'task_overdue',i.id,k,boundary) on conflict(source_id,overdue_day) do nothing;
 if found then made:=made+1;end if;
 end if;
 update community_private.penalty_progress set last_day=k where instance_id=i.id;processed:=processed+1;
 end loop;
 end loop;
 return jsonb_build_object('created',made,'processed',processed,'more',false);
end $$;
create function public.reconcile_community(target uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare report jsonb;person uuid;
begin
 perform public.organization_lock(target);report:=community_private.issue_overdue(target,now());
 for person in select user_id from public.home_members where home_id=target and active loop perform community_private.reconcile_person(target,person);end loop;
 return report;
end $$;
create function community_private.complete_overdue() returns trigger language plpgsql security definer set search_path='' as $$
declare person uuid;
begin
 if old.completed_at is null and new.completed_at is not null then
 perform 1 from public.homes where id=new.home_id for update;
 perform community_private.issue_overdue(new.home_id,new.completed_at,new.id);
 for person in select user_id from public.home_members where home_id=new.home_id and active loop perform community_private.reconcile_person(new.home_id,person);end loop;
 end if;return new;
end $$;
create trigger community_complete_overdue after update of completed_at on public.chore_instances for each row execute function community_private.complete_overdue();

-- Images have random names, no uploader in path. Storage's own owner and custom metadata must also be scrubbed.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('rating-photos','rating-photos',false,5242880,array['image/jpeg','image/png','image/webp']);
create function public.rating_photo_access(object_path text,write_access boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from community_private.rating_uploads u join public.ratings r on r.id=u.rating_id
 where u.path=object_path and public.is_home_member(u.home_id) and r.deleted_at is null
 and (not write_access or (u.actor=auth.uid() and u.created_at>now()-interval '1 hour' and r.source='manual')));
$$;
create function community_private.scrub_photo_metadata() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.bucket_id='rating-photos' then
 new.owner:=null;new.owner_id:=null;new.user_metadata:='{}'::jsonb;
 new.metadata:=jsonb_build_object('size',new.metadata->'size','mimetype',new.metadata->'mimetype','cacheControl',new.metadata->'cacheControl','eTag',new.metadata->'eTag','lastModified',new.metadata->'lastModified','contentLength',new.metadata->'contentLength','httpStatusCode',new.metadata->'httpStatusCode');
 end if;return new;
end $$;
create trigger community_photo_privacy before insert or update on storage.objects for each row execute function community_private.scrub_photo_metadata();
create policy rating_photo_read on storage.objects for select to authenticated using(bucket_id='rating-photos' and public.rating_photo_access(name));
create policy rating_photo_insert on storage.objects for insert to authenticated with check(bucket_id='rating-photos' and public.rating_photo_access(name,true) and name ~ '\.(jpg|png|webp)$');
create policy rating_photo_delete on storage.objects for delete to authenticated using(bucket_id='rating-photos' and public.rating_photo_access(name,true) and not exists(select 1 from public.ratings r where r.attachment_path=name));
create function public.prepare_rating_photo(target uuid,item uuid) returns text language plpgsql security definer set search_path='' as $$
declare path text;
begin
 perform public.organization_lock(target);
 if not exists(select 1 from public.ratings where home_id=target and id=item and source='manual' and deleted_at is null) then raise exception 'not_found';end if;
 path:=target::text||'/'||item::text||'/'||gen_random_uuid()::text||'.webp';
 insert into community_private.rating_uploads(path,home_id,rating_id,actor) values(path,target,item,auth.uid());return path;
end $$;
create function public.attach_rating_photo(target uuid,item uuid,expected_version integer,object_path text) returns void language plpgsql security definer set search_path='' as $$
declare r public.ratings;
begin
 perform public.organization_lock(target);select * into r from public.ratings where home_id=target and id=item and source='manual' and deleted_at is null;
 if not found then raise exception 'not_found';end if;
 if expected_version is null or expected_version<>r.version then raise exception 'stale_version';end if;
 if object_path is not null and (not exists(select 1 from community_private.rating_uploads where path=object_path and home_id=target and rating_id=item and actor=auth.uid()) or not exists(select 1 from storage.objects where bucket_id='rating-photos' and name=object_path)) then raise exception 'invalid_photo';end if;
 update public.ratings set attachment_path=object_path,version=version+1,updated_at=now() where id=item;
 insert into community_private.rating_audit(rating_id,home_id,actor,snapshot) select item,target,auth.uid(),to_jsonb(x) from public.ratings x where id=item;
end $$;
revoke all on all functions in schema community_private from public,anon,authenticated;
revoke all on function public.community_balances(uuid),public.rating_author_labels(uuid,uuid[]),public.save_rating_reason(uuid,uuid,integer,text,text,boolean,boolean),public.initialize_rating_reasons(uuid,text),public.save_rating(uuid,uuid,integer,uuid,uuid,text,boolean),public.delete_rating(uuid,uuid,integer),public.save_punishment(uuid,uuid,integer,text,boolean),public.reconcile_community(uuid),public.rating_photo_access(text,boolean),public.prepare_rating_photo(uuid,uuid),public.attach_rating_photo(uuid,uuid,integer,text) from public,anon;
grant execute on function public.community_balances(uuid),public.rating_author_labels(uuid,uuid[]),public.save_rating_reason(uuid,uuid,integer,text,text,boolean,boolean),public.initialize_rating_reasons(uuid,text),public.save_rating(uuid,uuid,integer,uuid,uuid,text,boolean),public.delete_rating(uuid,uuid,integer),public.save_punishment(uuid,uuid,integer,text,boolean),public.reconcile_community(uuid),public.rating_photo_access(text,boolean),public.prepare_rating_photo(uuid,uuid),public.attach_rating_photo(uuid,uuid,integer,text) to authenticated;
alter publication supabase_realtime add table public.rating_reasons,public.ratings,public.rating_redemptions,public.punishments;
commit;
