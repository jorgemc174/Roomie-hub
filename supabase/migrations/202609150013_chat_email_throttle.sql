-- Additive final delivery hardening after 010–012: opt-in chat email must not spam.
begin;
-- Match the other modules: membership and messages cascade within one transaction.
alter table public.chat_messages alter constraint chat_messages_home_id_author_user_id_fkey deferrable initially deferred;
alter table public.chat_reactions alter constraint chat_reactions_home_id_user_id_fkey deferrable initially deferred;
create table messaging_private.chat_email_windows (
 home_id uuid not null references public.homes on delete cascade,
 user_id uuid not null references public.profiles on delete cascade,
 next_allowed_at timestamptz not null,
 primary key(home_id,user_id)
);
alter table messaging_private.chat_email_windows enable row level security;
revoke all on messaging_private.chat_email_windows from public,anon,authenticated,service_role;
create function messaging_private.limit_chat_email() returns trigger language plpgsql security definer set search_path='' as $$
declare n public.notifications;accepted boolean;
begin
 if new.channel<>'email' then return new;end if;
 select * into n from public.notifications where id=new.notification_id;
 if n.category<>'chat' then return new;end if;
 insert into messaging_private.chat_email_windows(home_id,user_id,next_allowed_at)
 values(n.home_id,n.user_id,now()+interval '5 minutes')
 on conflict(home_id,user_id) do update set next_allowed_at=excluded.next_allowed_at
 where messaging_private.chat_email_windows.next_allowed_at<=now()
 returning true into accepted;
 if accepted then return new;end if;
 -- Canonical in-app notifications remain intact; only redundant external delivery is omitted.
 return null;
end $$;
revoke all on function messaging_private.limit_chat_email() from public,anon,authenticated,service_role;
create trigger chat_email_throttle before insert on messaging_private.notification_deliveries for each row execute function messaging_private.limit_chat_email();
create index notification_source_validation on public.notifications(home_id,source_table,source_id) where invalidated_at is null;
create index chore_upcoming_reminders on public.chore_instances(home_id,deadline_at,id) where completed_at is null and cancelled_at is null and not assignment_blocked;
commit;
