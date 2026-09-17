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
