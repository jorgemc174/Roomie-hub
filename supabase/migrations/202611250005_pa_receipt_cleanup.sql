begin;

-- The scheduled notification worker calls this even with external notices disabled.
-- Reserve paths in SQL, then delete via the Storage API and acknowledge the lease.
create function public.claim_receipt_cleanup() returns table(path text,lease uuid)
language plpgsql security definer set search_path='' as $$
declare candidate record; token uuid:=gen_random_uuid();
begin
 if not pg_try_advisory_xact_lock(620261125) then return; end if;
 for candidate in
  select o.id,o.name,split_part(o.name,'/',1)::uuid as home_id
  from storage.objects o
  where o.bucket_id='expense-receipts' and o.created_at<now()-interval '24 hours'
   and o.name ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/[^/]+/[^/]+/[^/]+$'
   and not exists(select 1 from messaging_private.receipt_cleanup q where q.path=o.name)
   and not exists(select 1 from public.expense_attachments a where a.path=o.name)
  order by o.created_at,o.name limit 100
 loop
  -- Use the same home lock as save_expense_with_receipt. A deleted home
  -- cannot accept new attachments and its leftover objects also expire.
  perform 1 from public.homes where id=candidate.home_id for update skip locked;
  if not found and exists(select 1 from public.homes where id=candidate.home_id) then continue; end if;
  insert into messaging_private.receipt_cleanup(path)
   select o.name from storage.objects o
   where o.id=candidate.id and o.bucket_id='expense-receipts' and o.name=candidate.name
    and o.created_at<now()-interval '24 hours'
    and not exists(select 1 from public.expense_attachments a where a.path=o.name)
   on conflict on constraint receipt_cleanup_pkey do nothing;
 end loop;

 return query
 with batch as (
  select q.path from messaging_private.receipt_cleanup q
  where q.leased_at is null or q.leased_at<now()-interval '5 minutes'
  order by q.queued_at,q.path limit 100
 )
 update messaging_private.receipt_cleanup q set lease=token,leased_at=now()
 from batch where q.path=batch.path returning q.path,q.lease;
end $$;

create function public.finish_receipt_cleanup(lease_token uuid) returns void
language sql security definer set search_path='' as $$
 delete from messaging_private.receipt_cleanup where lease=lease_token;
$$;
revoke all on function public.claim_receipt_cleanup(),public.finish_receipt_cleanup(uuid)
 from public,anon,authenticated;
grant execute on function public.claim_receipt_cleanup(),public.finish_receipt_cleanup(uuid) to service_role;

commit;
