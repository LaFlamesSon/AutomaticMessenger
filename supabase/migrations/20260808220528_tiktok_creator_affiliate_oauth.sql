create table public.ia_tiktok_oauth_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.ia_users(id) on delete cascade,
  state_hash text not null unique,
  redirect_uri text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.ia_tiktok_oauth_states enable row level security;
revoke all on public.ia_tiktok_oauth_states from public, anon, authenticated;
grant all on public.ia_tiktok_oauth_states to service_role;

create index if not exists ia_tiktok_oauth_states_user_idx
  on public.ia_tiktok_oauth_states(user_id, created_at desc);

create unique index if not exists ia_affiliate_connections_one_tiktok_per_user
  on public.ia_affiliate_connections(user_id)
  where provider = 'tiktok_shop';

create or replace function public.ia_upsert_tiktok_connection(
  p_user_id uuid,
  p_external_account_ref text,
  p_credential jsonb,
  p_scopes text[],
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection_id uuid;
  v_secret_id uuid;
  v_secret_name text;
begin
  if p_user_id is null or nullif(btrim(p_external_account_ref), '') is null
     or jsonb_typeof(p_credential) <> 'object' or coalesce(array_length(p_scopes, 1), 0) = 0 then
    raise exception 'invalid_tiktok_connection';
  end if;

  select id, credential_secret_id into v_connection_id, v_secret_id
    from public.ia_affiliate_connections
   where user_id = p_user_id and provider = 'tiktok_shop'
   for update;

  if v_connection_id is null then
    insert into public.ia_affiliate_connections
      (user_id, provider, external_account_ref, status, credential_mode, scopes, metadata)
    values
      (p_user_id, 'tiktok_shop', p_external_account_ref, 'pending', 'user_vault', p_scopes, coalesce(p_metadata, '{}'::jsonb))
    returning id into v_connection_id;
  end if;

  v_secret_name := 'ia_tiktok_creator_' || replace(v_connection_id::text, '-', '');
  if v_secret_id is null then
    select vault.create_secret(p_credential::text, v_secret_name, 'CaughtUp TikTok creator OAuth credential')
      into v_secret_id;
  else
    perform vault.update_secret(v_secret_id, p_credential::text, v_secret_name, 'CaughtUp TikTok creator OAuth credential');
  end if;

  update public.ia_affiliate_connections
     set external_account_ref = p_external_account_ref,
         status = 'connected',
         credential_mode = 'user_vault',
         credential_secret_id = v_secret_id,
         scopes = p_scopes,
         metadata = coalesce(p_metadata, '{}'::jsonb),
         error_code = null,
         updated_at = now()
   where id = v_connection_id and user_id = p_user_id;

  return v_connection_id;
end;
$$;

create or replace function public.ia_get_tiktok_credential(p_user_id uuid)
returns table (
  connection_id uuid,
  external_account_ref text,
  status text,
  scopes text[],
  metadata jsonb,
  sync_cursor text,
  credential jsonb
)
language sql
security definer
set search_path = ''
stable
as $$
  select c.id, c.external_account_ref, c.status::text, c.scopes, c.metadata,
         c.sync_cursor, d.decrypted_secret::jsonb
    from public.ia_affiliate_connections c
    join vault.decrypted_secrets d on d.id = c.credential_secret_id
   where c.user_id = p_user_id and c.provider = 'tiktok_shop'
   limit 1
$$;

create or replace function public.ia_disconnect_tiktok_connection(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  select credential_secret_id into v_secret_id
    from public.ia_affiliate_connections
   where user_id = p_user_id and provider = 'tiktok_shop'
   for update;
  if not found then return false; end if;
  update public.ia_affiliate_connections
     set status = 'disabled', credential_secret_id = null, error_code = null, updated_at = now()
   where user_id = p_user_id and provider = 'tiktok_shop';
  if v_secret_id is not null then delete from vault.secrets where id = v_secret_id; end if;
  return true;
end;
$$;

revoke all on function public.ia_upsert_tiktok_connection(uuid, text, jsonb, text[], jsonb) from public, anon, authenticated;
grant execute on function public.ia_upsert_tiktok_connection(uuid, text, jsonb, text[], jsonb) to service_role;
revoke all on function public.ia_get_tiktok_credential(uuid) from public, anon, authenticated;
grant execute on function public.ia_get_tiktok_credential(uuid) to service_role;
revoke all on function public.ia_disconnect_tiktok_connection(uuid) from public, anon, authenticated;
grant execute on function public.ia_disconnect_tiktok_connection(uuid) to service_role;
