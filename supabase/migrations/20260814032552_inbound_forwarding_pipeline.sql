-- Forwarded-email ingestion for Gmail send-only accounts.
-- All data remains service-role-only; users reach it through agent-api.

create table if not exists public.ia_forwarding_aliases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.ia_users(id) on delete cascade,
  gmail_account_id uuid not null unique references public.ia_gmail_accounts(id) on delete cascade,
  alias_token_hash text not null unique check (alias_token_hash ~ '^[0-9a-f]{64}$'),
  alias_address text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'verification_received', 'active', 'disabled')),
  verification_code text,
  confirmation_url text,
  verification_received_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (alias_address = lower(alias_address)),
  check (length(alias_address) between 20 and 320),
  check (verification_code is null or verification_code ~ '^[0-9]{6,20}$'),
  check (confirmation_url is null or confirmation_url like 'https://mail-settings.google.com/%')
);

create index if not exists ia_forwarding_aliases_status_idx
  on public.ia_forwarding_aliases(status, updated_at desc);

create table if not exists public.ia_inbound_messages (
  id uuid primary key default gen_random_uuid(),
  forwarding_alias_id uuid not null references public.ia_forwarding_aliases(id) on delete cascade,
  user_id uuid not null references public.ia_users(id) on delete cascade,
  gmail_account_id uuid not null references public.ia_gmail_accounts(id) on delete cascade,
  dedupe_key text not null check (dedupe_key ~ '^[0-9a-f]{64}$'),
  rfc_message_id text not null default '',
  thread_key text not null default '',
  envelope_from text not null default '',
  header_from text not null default '',
  reply_to text not null default '',
  original_to text not null default '',
  subject text not null default '',
  text_body text not null default '',
  in_reply_to text not null default '',
  references_header text not null default '',
  received_at timestamptz not null default now(),
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processing', 'processed', 'discarded', 'error')),
  error_code text,
  processed_email_id uuid,
  safe_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (forwarding_alias_id, dedupe_key),
  check (length(rfc_message_id) <= 998),
  check (length(thread_key) <= 998),
  check (length(envelope_from) <= 320),
  check (length(header_from) <= 500),
  check (length(reply_to) <= 500),
  check (length(original_to) <= 1000),
  check (length(subject) <= 500),
  check (length(text_body) <= 100000),
  check (length(in_reply_to) <= 998),
  check (length(references_header) <= 998)
);

create index if not exists ia_inbound_messages_account_idx
  on public.ia_inbound_messages(gmail_account_id, received_at desc);
create index if not exists ia_inbound_messages_status_idx
  on public.ia_inbound_messages(processing_status, received_at);

alter table public.ia_processed_emails
  add column if not exists ingestion_source text not null default 'gmail_api',
  add column if not exists inbound_message_id uuid,
  add column if not exists reply_to_address text,
  add column if not exists rfc_message_id text,
  add column if not exists rfc_in_reply_to text,
  add column if not exists rfc_references text,
  add column if not exists outbound_message_id text,
  add column if not exists draft_version text,
  add column if not exists draft_updated_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ia_processed_emails_ingestion_source_check') then
    alter table public.ia_processed_emails add constraint ia_processed_emails_ingestion_source_check
      check (ingestion_source in ('gmail_api', 'forwarded'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ia_processed_emails_inbound_message_fkey') then
    alter table public.ia_processed_emails add constraint ia_processed_emails_inbound_message_fkey
      foreign key (inbound_message_id) references public.ia_inbound_messages(id) on delete set null;
  end if;
end $$;

create unique index if not exists ia_processed_emails_inbound_message_uidx
  on public.ia_processed_emails(inbound_message_id) where inbound_message_id is not null;
create index if not exists ia_processed_emails_rfc_thread_idx
  on public.ia_processed_emails(gmail_account_id, thread_id, processed_at desc)
  where ingestion_source = 'forwarded';
create index if not exists ia_processed_emails_outbound_message_idx
  on public.ia_processed_emails(gmail_account_id, outbound_message_id)
  where outbound_message_id is not null;

alter table public.ia_forwarding_aliases enable row level security;
alter table public.ia_inbound_messages enable row level security;

revoke all on table public.ia_forwarding_aliases from anon, authenticated;
revoke all on table public.ia_inbound_messages from anon, authenticated;
grant all on table public.ia_forwarding_aliases to service_role;
grant all on table public.ia_inbound_messages to service_role;

alter table public.ia_inbound_messages
  add constraint ia_inbound_messages_processed_email_fkey
  foreign key (processed_email_id) references public.ia_processed_emails(id) on delete set null;
