begin;

-- The app uploads re-encoded WebP only. Reject other declared formats; the
-- download route also decodes/re-encodes, since MIME metadata is client input.
update storage.buckets set allowed_mime_types = array['image/webp']
where id = 'rating-photos';
-- ALTER instead of DROP/CREATE: same result without a destructive statement.
alter policy rating_photo_insert on storage.objects to authenticated
with check (
  bucket_id = 'rating-photos'
  and public.rating_photo_access(name, true)
  and name ~ '\.webp$'
  and metadata->>'mimetype' = 'image/webp'
);

-- Reserve CPU-intensive decoding attempts before reading any attachment bytes.
-- Kept separate from the existing upload quota so failed decodes also consume
-- capacity, and direct prepare_chat_attachment calls retain their own throttle.
create function public.authorize_chat_uploads(target uuid, file_count integer)
returns void language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform public.organization_lock(target);
  if file_count is null or file_count not between 0 and 3 then
    raise exception 'invalid_attachment';
  end if;
  for n in 1..file_count loop
    perform messaging_private.throttle(target, 'upload_decode', 10);
  end loop;
end $$;
revoke all on function public.authorize_chat_uploads(uuid, integer) from public, anon;
grant execute on function public.authorize_chat_uploads(uuid, integer) to authenticated;

commit;
