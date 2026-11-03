-- Completed shopping lists require an explicit reopen under the existing home lock.
create or replace function public.shopping_command(target uuid,operation text,list_id uuid default null,item_id uuid default null,label text default null,checked boolean default true)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; nm text;
begin
 perform public.organization_lock(target);
 if operation in ('create_list','rename_list','add_item') and
  (label is null or char_length(btrim(label)) not between 1 and 100 or label ~ '^[[:space:]]*$')
 then raise exception 'invalid_name'; end if;
 select name into nm from public.profiles where id=auth.uid();
 if operation='create_list' then
  insert into public.shopping_lists(home_id,name,created_by,created_by_name) values(target,trim(label),auth.uid(),nm) returning id into result;
  return result;
 end if;
 if not exists(select 1 from public.shopping_lists where home_id=target and id=list_id and deleted_at is null) then raise exception 'not_found'; end if;
 if operation in ('rename_list','add_item','toggle_item','delete_item') and exists(
  select 1 from public.shopping_lists where id=list_id and completed_at is not null
 ) then raise exception 'list_completed'; end if;
 result:=list_id;
 if operation='reopen_list' then
  update public.shopping_lists set completed_at=null,completed_by=null,completed_by_name=null,updated_at=now() where id=list_id;
 elsif operation='rename_list' then
  update public.shopping_lists set name=trim(label),updated_at=now() where id=list_id;
 elsif operation='delete_list' then
  update public.shopping_lists set deleted_at=now(),updated_at=now() where id=list_id;
  update public.shopping_items set deleted_at=now(),updated_at=now() where shopping_list_id=list_id and deleted_at is null;
 elsif operation='add_item' then
  insert into public.shopping_items(home_id,shopping_list_id,name,created_by,created_by_name) values(target,list_id,trim(label),auth.uid(),nm) returning id into result;
  update public.shopping_lists set completed_at=null,completed_by=null,completed_by_name=null,updated_at=now() where id=list_id;
 elsif operation in ('toggle_item','delete_item') then
  if not exists(select 1 from public.shopping_items where id=item_id and home_id=target and shopping_list_id=list_id and deleted_at is null) then raise exception 'not_found'; end if;
  if operation='delete_item' then update public.shopping_items set deleted_at=now(),updated_at=now() where id=item_id;
  else
   update public.shopping_items set purchased=checked,completed_at=case when checked then now() end,completed_by=case when checked then auth.uid() end,
    completed_by_name=case when checked then nm end,updated_at=now() where id=item_id and purchased is distinct from checked;
  end if;
 elsif operation='complete_list' then
  update public.shopping_items set purchased=true,completed_at=now(),completed_by=auth.uid(),completed_by_name=nm,updated_at=now()
  where shopping_list_id=list_id and deleted_at is null and not purchased;
 else raise exception 'invalid_operation';
 end if;
 if operation in ('toggle_item','delete_item','complete_list') then
  if exists(select 1 from public.shopping_items where shopping_list_id=list_id and deleted_at is null) and not exists(select 1 from public.shopping_items where shopping_list_id=list_id and deleted_at is null and not purchased) then
   update public.shopping_lists set completed_at=coalesce(completed_at,now()),completed_by=coalesce(completed_by,auth.uid()),completed_by_name=coalesce(completed_by_name,nm),updated_at=now() where id=list_id;
  else update public.shopping_lists set completed_at=null,completed_by=null,completed_by_name=null,updated_at=now() where id=list_id;
  end if;
 end if;
 return result;
end $$;


revoke all on function public.shopping_command(uuid,text,uuid,uuid,text,boolean) from public,anon;
grant execute on function public.shopping_command(uuid,text,uuid,uuid,text,boolean) to authenticated;
