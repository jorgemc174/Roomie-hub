begin;

-- Reserve expired paths until the worker has removed their backing bytes.
create table messaging_private.receipt_cleanup (
 path text primary key, queued_at timestamptz not null default now(),
 lease uuid, leased_at timestamptz
);
alter table messaging_private.receipt_cleanup enable row level security;
revoke all on messaging_private.receipt_cleanup from public,anon,authenticated,service_role;
-- Four components distinguish private uploads from existing three-component receipts.
create function public.owns_receipt_upload(object_name text) returns boolean
language sql stable set search_path='' as $$
 select case when object_name ~
  '^[0-9a-f-]{36}/(staging|[0-9a-f-]{36})/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$'
  and split_part(object_name,'/',3)=auth.uid()::text
  and split_part(object_name,'/',1) ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
 then public.is_home_member(split_part(object_name,'/',1)::uuid) else false end;
$$;
revoke all on function public.owns_receipt_upload(text) from public,anon;
grant execute on function public.owns_receipt_upload(text) to authenticated;

create function public.receipt_cleanup_pending(object_path text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from messaging_private.receipt_cleanup where path=object_path and public.owns_receipt_upload(object_path));
$$;
revoke all on function public.receipt_cleanup_pending(text) from public,anon;
grant execute on function public.receipt_cleanup_pending(text) to authenticated;

alter policy receipt_insert on storage.objects to authenticated with check (
 bucket_id='expense-receipts' and not public.receipt_cleanup_pending(name) and (
  public.owns_receipt_upload(name)
  or (cardinality(string_to_array(name,'/'))=3 and public.can_access_receipt(name)
      and name ~ '\.(jpg|png|webp|pdf)$')
 )
);
alter policy receipt_read on storage.objects to authenticated using (
 bucket_id='expense-receipts' and (
  public.owns_receipt_upload(name)
  or (public.can_access_receipt(name) and (cardinality(string_to_array(name,'/'))=3
      or exists(select 1 from public.expense_attachments a where a.path=name)))
 )
);
alter policy receipt_delete on storage.objects to authenticated using (
 bucket_id='expense-receipts' and (
  public.owns_receipt_upload(name)
  or (cardinality(string_to_array(name,'/'))=3 and public.can_access_receipt(name))
 ) and not exists(select 1 from public.expense_attachments a where a.path=name)
);

create or replace function public.attach_expense_receipt(target uuid,item uuid,object_path text,media_type text,byte_size integer)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.organization_lock(target);
 if not exists(select 1 from public.expenses where home_id=target and id=item and deleted_at is null)
  or object_path not like target::text||'/'||item::text||'/%'
  or not (cardinality(string_to_array(object_path,'/'))=3 or public.owns_receipt_upload(object_path))
 then raise exception 'not_found'; end if;
 if not exists(select 1 from storage.objects where bucket_id='expense-receipts' and name=object_path)
 then raise exception 'receipt_missing'; end if;
 insert into public.expense_attachments(home_id,expense_id,path,mime,size)
 values(target,item,object_path,media_type,byte_size) on conflict(path) do nothing;
 update public.expenses set updated_at=now() where id=item;
end $$;
revoke execute on function public.attach_expense_receipt(uuid,uuid,text,text,integer)
 from public,anon,authenticated,service_role;

-- Verify actual Storage metadata before either posting the expense or confirming an occurrence.
-- Save/confirm and attachment metadata commit together under the existing home lock.
create function public.save_expense_with_receipt(target uuid,item uuid,expected_version integer,body jsonb,object_path text,confirm_occurrence boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare object_metadata jsonb; mime text; bytes text; extension text; expense uuid;
begin
 perform public.organization_lock(target);
 if object_path is null or not public.owns_receipt_upload(object_path)
    or object_path not like target::text||'/'||item::text||'/%'
    or public.receipt_cleanup_pending(object_path)
 then raise exception 'invalid_receipt'; end if;
 select o.metadata into object_metadata from storage.objects o
 where o.bucket_id='expense-receipts' and o.name=object_path and o.owner_id=auth.uid()::text;
 if not found then raise exception 'invalid_receipt'; end if;
 -- Storage supplies metadata; client-supplied user_metadata is never trusted.
 mime:=lower(btrim(split_part(object_metadata->>'mimetype',';',1)));
 bytes:=coalesce(object_metadata->>'size',object_metadata->>'contentLength');
 extension:=case mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png'
  when 'image/webp' then 'webp' when 'application/pdf' then 'pdf' end;
 if extension is null or right(object_path,length(extension)+1) <> '.'||extension
    or coalesce(bytes,'') !~ '^[0-9]{1,8}$' then raise exception 'invalid_receipt'; end if;
 if bytes::integer not between 1 and 10485760 then raise exception 'invalid_receipt'; end if;

 if confirm_occurrence then
  expense:=public.confirm_recurring_expense(target,item,body);
 else
  expense:=public.save_expense(target,item,expected_version,body);
 end if;
 perform public.attach_expense_receipt(target,expense,object_path,mime,bytes::integer);
 return expense;
end $$;
revoke all on function public.save_expense_with_receipt(uuid,uuid,integer,jsonb,text,boolean) from public,anon;
grant execute on function public.save_expense_with_receipt(uuid,uuid,integer,jsonb,text,boolean) to authenticated;

commit;
