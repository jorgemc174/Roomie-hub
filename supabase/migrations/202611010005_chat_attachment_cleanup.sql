-- Expired preparations cannot be sent again. Keep Storage deletion durable and
-- use its API from the existing worker: deleting storage.objects is not enough.
begin;
create index chat_attachments_pending_expiry on public.chat_attachments(created_at,home_id)
 where message_id is null;
create table messaging_private.chat_attachment_cleanup (
 path text primary key, queued_at timestamptz not null default now()
);
alter table messaging_private.chat_attachment_cleanup enable row level security;
revoke all on messaging_private.chat_attachment_cleanup from public,anon,authenticated,service_role;

create function messaging_private.purge_expired_chat_attachments() returns integer
language plpgsql security definer set search_path='' as $$
declare h record;removed integer;total integer:=0;
begin
 for h in select distinct home_id from public.chat_attachments
  where message_id is null and created_at<=now()-interval '1 hour' order by home_id loop
  -- Serialize with send_chat_message, including a send that began before expiry.
  perform 1 from public.homes where id=h.home_id for update skip locked;
  if not found then continue;end if;
  with expired as (
   delete from public.chat_attachments where home_id=h.home_id
    and message_id is null and created_at<=now()-interval '1 hour' returning path
  )
  insert into messaging_private.chat_attachment_cleanup(path)
   select path from expired on conflict do nothing;
  get diagnostics removed=row_count;
  total:=total+removed;
 end loop;
 return total;
end $$;
revoke all on function messaging_private.purge_expired_chat_attachments() from public,anon,authenticated,service_role;

create function public.pending_chat_attachment_cleanup() returns text[]
language sql security definer set search_path='' as $$
 select coalesce(array_agg(path order by queued_at,path),'{}'::text[]) from (
  select path,queued_at from messaging_private.chat_attachment_cleanup order by queued_at,path limit 100
 ) pending;
$$;
create function public.finish_chat_attachment_cleanup(paths text[]) returns void
language sql security definer set search_path='' as $$
 delete from messaging_private.chat_attachment_cleanup where path=any(paths);
$$;
revoke all on function public.pending_chat_attachment_cleanup(),public.finish_chat_attachment_cleanup(text[]) from public,anon,authenticated;
grant execute on function public.pending_chat_attachment_cleanup(),public.finish_chat_attachment_cleanup(text[]) to service_role;

-- Reuse the domain job already scheduled every five minutes; no extra cron.
create or replace function messaging_private.run_jobs() returns jsonb language plpgsql security definer set search_path='' as $$
declare h record;person uuid;old_claim text;run_id bigint;processed integer:=0;errors integer:=0;code text;
begin
 if not pg_try_advisory_xact_lock(620260916) then return jsonb_build_object('busy',true);end if;
 insert into messaging_private.job_runs default values returning id into run_id;
 old_claim:=current_setting('request.jwt.claim.sub',true);
 perform messaging_private.purge_expired_chat_attachments();
 insert into messaging_private.home_jobs(home_id) select id from public.homes on conflict do nothing;
 for h in select j.home_id from messaging_private.home_jobs j order by j.last_run_at,j.home_id limit 100 loop
  begin
   perform 1 from public.homes where id=h.home_id for update skip locked;
   if not found then continue;end if;
   select user_id into person from public.home_members where home_id=h.home_id and active order by user_id limit 1;
   if person is not null then
    perform set_config('request.jwt.claim.sub',person::text,true);
    perform public.ensure_current_chores(h.home_id);
    perform public.reconcile_chore_assignments(h.home_id);
    perform public.generate_recurring_expenses(h.home_id);
    perform public.reconcile_community(h.home_id);
   end if;
   update messaging_private.home_jobs set last_run_at=now() where home_id=h.home_id;
   processed:=processed+1;
  exception when others then
   errors:=errors+1;get stacked diagnostics code=returned_sqlstate;
   update messaging_private.home_jobs set last_run_at=now() where home_id=h.home_id;
  end;
 end loop;
 for h in select home_id from messaging_private.home_jobs order by home_id loop
  begin
   perform messaging_private.remind_home(h.home_id,now());
  exception when others then
   errors:=errors+1;get stacked diagnostics code=returned_sqlstate;
  end;
 end loop;
 perform set_config('request.jwt.claim.sub',coalesce(old_claim,''),true);
 delete from messaging_private.rate_limits where window_at<now()-interval '1 day';
 delete from messaging_private.job_runs where started_at<now()-interval '30 days';
 update messaging_private.job_runs set finished_at=now(),homes_processed=processed,error_count=errors,last_error_code=code where id=run_id;
 return jsonb_build_object('homes',processed,'errors',errors);
end $$;
commit;
