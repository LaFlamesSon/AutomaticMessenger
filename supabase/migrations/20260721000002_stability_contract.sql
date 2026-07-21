-- CaughtUp stability/configurability contract.
-- Additive only: preserves legacy columns while introducing explicit identity,
-- delivery, preference, media-kit, OAuth-state, and idempotency records.

alter table ia_users add column if not exists api_token uuid default gen_random_uuid();
alter table ia_users add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
alter table ia_users add column if not exists api_token_revoked_at timestamptz;
alter table ia_users add column if not exists plan text not null default 'free';
alter table ia_users add column if not exists stripe_customer_id text;
update ia_users set api_token = gen_random_uuid() where api_token is null;
alter table ia_users alter column api_token set not null;
create unique index if not exists ia_users_api_token_uidx on ia_users(api_token);
create unique index if not exists ia_users_auth_user_uidx on ia_users(auth_user_id) where auth_user_id is not null;
create index if not exists ia_gmail_accounts_user_idx on ia_gmail_accounts(user_id, connected_at desc);
create index if not exists ia_agent_runs_account_idx on ia_agent_runs(gmail_account_id, started_at desc);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ia_users_plan_check') then
    alter table ia_users add constraint ia_users_plan_check check (plan in ('free', 'trial', 'pro'));
  end if;
end $$;

alter table ia_voice_profiles add column if not exists auto_send boolean not null default false;
alter table ia_voice_profiles add column if not exists reply_mode text not null default 'draft_only';
alter table ia_voice_profiles add column if not exists draft_categories text[] not null default array['urgent','action_needed'];
alter table ia_voice_profiles add column if not exists auto_send_categories text[] not null default array[]::text[];
alter table ia_voice_profiles add column if not exists auto_send_confirmed_at timestamptz;
alter table ia_voice_profiles add column if not exists auto_send_policy_version text;
alter table ia_voice_profiles add column if not exists settings_version bigint not null default 1;
alter table ia_voice_profiles add column if not exists sweep_enabled boolean not null default true;
alter table ia_voice_profiles add column if not exists sweep_interval_minutes integer not null default 180;
alter table ia_voice_profiles add column if not exists digest_enabled boolean not null default true;
alter table ia_voice_profiles add column if not exists digest_local_time time not null default '08:00';
alter table ia_voice_profiles add column if not exists timezone text not null default 'America/Los_Angeles';
alter table ia_voice_profiles add column if not exists last_digest_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ia_voice_profiles_reply_mode_check') then
    alter table ia_voice_profiles add constraint ia_voice_profiles_reply_mode_check
      check (reply_mode in ('draft_only', 'auto_send'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ia_voice_profiles_sweep_interval_check') then
    alter table ia_voice_profiles add constraint ia_voice_profiles_sweep_interval_check
      check (sweep_interval_minutes between 15 and 1440);
  end if;
end $$;

alter table ia_processed_emails add column if not exists auto_sent boolean not null default false;
alter table ia_processed_emails add column if not exists draft_text text;
alter table ia_processed_emails add column if not exists gmail_draft_id text;
alter table ia_processed_emails add column if not exists gmail_draft_message_id text;
alter table ia_processed_emails add column if not exists edit_captured boolean not null default false;
alter table ia_processed_emails add column if not exists delivery_status text not null default 'none';
alter table ia_processed_emails add column if not exists sent_via text;
alter table ia_processed_emails add column if not exists gmail_sent_message_id text;
alter table ia_processed_emails add column if not exists sent_at timestamptz;
alter table ia_processed_emails add column if not exists selected_media_kit_id uuid;
update ia_processed_emails
set delivery_status = case
  when auto_sent then 'sent'
  when draft_created then 'draft'
  else 'none'
end
where delivery_status = 'none' and (auto_sent or draft_created);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ia_processed_emails_delivery_status_check') then
    alter table ia_processed_emails add constraint ia_processed_emails_delivery_status_check
      check (delivery_status in ('none', 'draft', 'sending', 'sent', 'failed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ia_processed_emails_sent_via_check') then
    alter table ia_processed_emails add constraint ia_processed_emails_sent_via_check
      check (sent_via is null or sent_via in ('manual_extension', 'manual_gmail', 'auto'));
  end if;
end $$;

create table if not exists ia_chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references ia_users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists ia_chat_messages_user_idx on ia_chat_messages(user_id, created_at desc);

create table if not exists ia_auto_send_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references ia_users(id) on delete cascade,
  challenge_hash text not null unique,
  policy_version text not null,
  prepared_settings_version bigint not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table ia_auto_send_challenges add column if not exists prepared_settings_version bigint;
create index if not exists ia_auto_send_challenges_user_idx
  on ia_auto_send_challenges(user_id, created_at desc);

create table if not exists ia_settings_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references ia_users(id) on delete cascade,
  action text not null,
  safe_details jsonb not null default '{}'::jsonb,
  request_id text,
  created_at timestamptz not null default now()
);

create table if not exists ia_sender_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references ia_users(id) on delete cascade,
  match_type text not null check (match_type in ('email', 'domain')),
  match_value text not null,
  action text not null check (action in ('never_draft', 'always_draft', 'require_approval', 'allow_auto_send')),
  priority integer not null default 100,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, match_type, match_value, action)
);

create table if not exists ia_media_kits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references ia_users(id) on delete cascade,
  label text not null,
  best_for text not null default '',
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  byte_size integer not null check (byte_size > 0 and byte_size <= 8000000),
  brand_names text[] not null default array[]::text[],
  sender_domains text[] not null default array[]::text[],
  keywords text[] not null default array[]::text[],
  is_default boolean not null default false,
  auto_attach boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'active', 'cleanup_required', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, storage_path)
);
create unique index if not exists ia_media_kits_user_label_uidx
  on ia_media_kits(user_id, lower(label)) where status <> 'archived';
create unique index if not exists ia_media_kits_one_default_uidx
  on ia_media_kits(user_id) where is_default and status = 'active';
create index if not exists ia_media_kits_user_idx on ia_media_kits(user_id, status, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media-kit', 'media-kit', false, 8000000,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ia_processed_emails_selected_media_kit_fkey') then
    alter table ia_processed_emails add constraint ia_processed_emails_selected_media_kit_fkey
      foreign key (selected_media_kit_id) references ia_media_kits(id) on delete set null;
  end if;
end $$;

create table if not exists ia_send_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references ia_users(id) on delete cascade,
  processed_email_id uuid not null references ia_processed_emails(id) on delete cascade,
  idempotency_key text not null,
  status text not null default 'claimed' check (status in ('claimed', 'sending', 'sent', 'failed', 'reconcile')),
  gmail_message_id text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create unique index if not exists ia_send_attempts_active_email_uidx
  on ia_send_attempts(processed_email_id)
  where status in ('claimed', 'sending', 'sent', 'reconcile');

create table if not exists ia_oauth_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references ia_users(id) on delete cascade,
  state_hash text not null unique,
  redirect_uri text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table ia_oauth_states add column if not exists redirect_uri text;

create table if not exists ia_job_claims (
  id uuid primary key default gen_random_uuid(),
  gmail_account_id uuid not null references ia_gmail_accounts(id) on delete cascade,
  job_type text not null check (job_type in ('sweep', 'digest')),
  window_key text not null,
  status text not null default 'claimed' check (status in ('claimed', 'sending', 'sent', 'reconcile', 'ok', 'error')),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (gmail_account_id, job_type, window_key)
);
create unique index if not exists ia_job_claims_one_active_uidx
  on ia_job_claims(gmail_account_id, job_type)
  where status in ('claimed', 'sending', 'sent', 'reconcile');

create table if not exists ia_message_claims (
  id uuid primary key default gen_random_uuid(),
  gmail_account_id uuid not null references ia_gmail_accounts(id) on delete cascade,
  gmail_message_id text not null,
  status text not null default 'claimed' check (status in ('claimed', 'sending', 'sent', 'reconcile', 'complete', 'error')),
  claimed_at timestamptz not null default now(),
  finished_at timestamptz,
  error_code text,
  gmail_sent_message_id text,
  gmail_draft_id text,
  unique (gmail_account_id, gmail_message_id)
);

create or replace function ia_confirm_auto_send(
  p_user_id uuid,
  p_challenge_hash text,
  p_policy_version text
)
returns setof ia_voice_profiles
language sql
security definer
set search_path = public
as $$
  with claimed as (
    update ia_auto_send_challenges challenge
    set used_at = now()
    from ia_voice_profiles profile
    where challenge.user_id = p_user_id
      and challenge.challenge_hash = p_challenge_hash
      and challenge.policy_version = p_policy_version
      and challenge.used_at is null
      and challenge.expires_at > now()
      and profile.user_id = challenge.user_id
      and profile.settings_version = challenge.prepared_settings_version
      and nullif(btrim(profile.custom_rules), '') is null
    returning challenge.user_id, challenge.prepared_settings_version
  ), updated as (
    update ia_voice_profiles profile
    set reply_mode = 'auto_send',
        auto_send = true,
        auto_send_confirmed_at = now(),
        auto_send_policy_version = p_policy_version,
        updated_at = now(),
        settings_version = profile.settings_version + 1
    from claimed
    where profile.user_id = claimed.user_id
      and profile.settings_version = claimed.prepared_settings_version
    returning profile.*
  ), audited as (
    insert into ia_settings_audit (user_id, action, safe_details)
    select user_id, 'auto_send_enabled', jsonb_build_object('policy_version', p_policy_version)
    from updated
    returning 1
  )
  select updated.* from updated, audited;
$$;
revoke all on function ia_confirm_auto_send(uuid, text, text) from public, anon, authenticated;
grant execute on function ia_confirm_auto_send(uuid, text, text) to service_role;

create or replace function ia_disable_auto_send(p_user_id uuid)
returns setof ia_voice_profiles
language sql
security definer
set search_path = public
as $$
  with updated as (
    update ia_voice_profiles profile
    set reply_mode = 'draft_only',
        auto_send = false,
        auto_send_confirmed_at = null,
        auto_send_policy_version = null,
        updated_at = now(),
        settings_version = profile.settings_version + 1
    where profile.user_id = p_user_id
    returning profile.*
  ), audited as (
    insert into ia_settings_audit (user_id, action)
    select user_id, 'auto_send_disabled' from updated
    returning 1
  )
  select updated.* from updated, audited;
$$;
revoke all on function ia_disable_auto_send(uuid) from public, anon, authenticated;
grant execute on function ia_disable_auto_send(uuid) to service_role;

create or replace function ia_claim_job(p_gmail_account_id uuid, p_job_type text, p_window_key text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare claimed_id uuid;
begin
  update ia_job_claims
  set status = 'error', finished_at = now()
  where gmail_account_id = p_gmail_account_id and job_type = p_job_type
    and status = 'claimed' and created_at < now() - interval '15 minutes';

  if exists (
    select 1 from ia_job_claims where gmail_account_id = p_gmail_account_id and job_type = p_job_type
      and status in ('claimed', 'sending', 'sent', 'reconcile')
  ) then return null; end if;

  insert into ia_job_claims (gmail_account_id, job_type, window_key)
  values (p_gmail_account_id, p_job_type, p_window_key)
  on conflict (gmail_account_id, job_type, window_key) do update
    set status = 'claimed', created_at = now(), finished_at = null
    where ia_job_claims.status = 'error'
  returning id into claimed_id;
  return claimed_id;
exception when unique_violation then
  return null;
end;
$$;
revoke all on function ia_claim_job(uuid, text, text) from public, anon, authenticated;
grant execute on function ia_claim_job(uuid, text, text) to service_role;

alter table ia_chat_messages enable row level security;
alter table ia_auto_send_challenges enable row level security;
alter table ia_settings_audit enable row level security;
alter table ia_sender_rules enable row level security;
alter table ia_media_kits enable row level security;
alter table ia_send_attempts enable row level security;
alter table ia_oauth_states enable row level security;
alter table ia_job_claims enable row level security;
alter table ia_message_claims enable row level security;

create or replace function ia_claim_message(p_gmail_account_id uuid, p_gmail_message_id text)
returns uuid
language sql
security definer
set search_path = public
as $$
  insert into ia_message_claims (gmail_account_id, gmail_message_id)
  values (p_gmail_account_id, p_gmail_message_id)
  on conflict (gmail_account_id, gmail_message_id) do update
    set status = 'claimed', claimed_at = now(), finished_at = null, error_code = null
    where ia_message_claims.status = 'error'
       or (ia_message_claims.status = 'claimed'
           and ia_message_claims.claimed_at < now() - interval '15 minutes')
  returning id;
$$;
revoke all on function ia_claim_message(uuid, text) from public, anon, authenticated;
grant execute on function ia_claim_message(uuid, text) to service_role;

-- Service-role functions are the only data access path; remove accidental grants.
revoke all on ia_chat_messages, ia_auto_send_challenges, ia_settings_audit,
  ia_sender_rules, ia_media_kits, ia_send_attempts, ia_oauth_states,
  ia_job_claims, ia_message_claims from anon, authenticated;
grant all on ia_chat_messages, ia_auto_send_challenges, ia_settings_audit,
  ia_sender_rules, ia_media_kits, ia_send_attempts, ia_oauth_states,
  ia_job_claims, ia_message_claims to service_role;
