-- Runtime configuration and an explicit post-deploy dispatcher installer.
-- This migration never changes active cron jobs by itself.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function public.ia_get_config()
returns table(name text, secret text)
language sql
security definer
set search_path = ''
as $$
  select decrypted.name, decrypted.decrypted_secret
  from vault.decrypted_secrets as decrypted
  where decrypted.name like 'ia\_%' escape '\';
$$;
revoke all on function public.ia_get_config() from public, anon, authenticated;
grant execute on function public.ia_get_config() to service_role;

create or replace function public.ia_install_dispatch_cron(p_base_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_url text := rtrim(p_base_url, '/');
  existing_job bigint;
begin
  if normalized_url !~ '^https://[a-z0-9]{20}\.supabase\.co$'
     and normalized_url !~ '^http://(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal|kong)(:[0-9]+)?$' then
    raise exception 'p_base_url must be a Supabase project origin or an approved local HTTP origin';
  end if;

  for existing_job in
    select jobid from cron.job
    where jobname in ('caughtup-daily-digest', 'inbox-agent-daily-digest', 'inbox-agent-sweep')
  loop
    perform cron.unschedule(existing_job);
  end loop;

  perform cron.schedule('inbox-agent-sweep', '*/5 * * * *', format($command$
    select net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-agent-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ia_agent_cron_secret' limit 1)
      ),
      body := '{"trigger":"scheduled"}'::jsonb
    );
  $command$, normalized_url || '/functions/v1/agent-sweep'));

  perform cron.schedule('inbox-agent-daily-digest', '*/5 * * * *', format($command$
    select net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-agent-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ia_agent_cron_secret' limit 1)
      ),
      body := '{}'::jsonb
    );
  $command$, normalized_url || '/functions/v1/daily-digest'));
end;
$$;
revoke all on function public.ia_install_dispatch_cron(text) from public, anon, authenticated;
grant execute on function public.ia_install_dispatch_cron(text) to service_role;
