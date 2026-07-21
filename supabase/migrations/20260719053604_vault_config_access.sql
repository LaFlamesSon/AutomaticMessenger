-- Config via Supabase Vault: secrets are stored encrypted and exposed to the
-- Edge Functions (service role) through a locked-down RPC.

create or replace function public.ia_get_config()
returns table(name text, secret text)
language sql
security definer
set search_path = ''
as $$
  select name, decrypted_secret
  from vault.decrypted_secrets
  where name like 'ia_%';
$$;

revoke all on function public.ia_get_config() from public;
revoke all on function public.ia_get_config() from anon;
revoke all on function public.ia_get_config() from authenticated;
grant execute on function public.ia_get_config() to service_role;;
