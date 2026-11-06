-- Reveal only the home identity needed for explicit invitation confirmation.
create function public.preview_invitation(invite_code text)
returns table(home_id uuid, home_name text, already_member boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null then raise exception 'unauthorized'; end if;
 return query
 select h.id, h.name, public.is_home_member(h.id)
 from public.invitations i
 join public.homes h on h.id=i.home_id
 where i.code=lower(trim(invite_code));
end;
$$;

revoke execute on function public.preview_invitation(text) from public, anon;
grant execute on function public.preview_invitation(text) to authenticated;
