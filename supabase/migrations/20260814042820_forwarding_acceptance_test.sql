-- One-use, self-addressed acceptance messages verify the real Gmail forwarding
-- route without allowing the generated reply to be sent.

create table public.ia_forwarding_test_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.ia_users(id) on delete cascade,
  gmail_account_id uuid not null references public.ia_gmail_accounts(id) on delete cascade,
  forwarding_alias_id uuid not null references public.ia_forwarding_aliases(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'processing', 'processed', 'failed', 'expired')),
  inbound_rfc_message_id text,
  gmail_sent_message_id text,
  processed_email_id uuid references public.ia_processed_emails(id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (inbound_rfc_message_id is null or length(inbound_rfc_message_id) <= 998),
  check (gmail_sent_message_id is null or length(gmail_sent_message_id) <= 998)
);

create index ia_forwarding_test_runs_user_created_idx
  on public.ia_forwarding_test_runs(user_id, created_at desc);
create index ia_forwarding_test_runs_account_idx
  on public.ia_forwarding_test_runs(gmail_account_id, created_at desc);
create index ia_forwarding_test_runs_alias_idx
  on public.ia_forwarding_test_runs(forwarding_alias_id, created_at desc);
create index ia_forwarding_test_runs_processed_email_idx
  on public.ia_forwarding_test_runs(processed_email_id)
  where processed_email_id is not null;
create index ia_forwarding_test_runs_expiry_idx
  on public.ia_forwarding_test_runs(status, expires_at);

alter table public.ia_forwarding_test_runs enable row level security;
revoke all on table public.ia_forwarding_test_runs from public, anon, authenticated;
grant all on table public.ia_forwarding_test_runs to service_role;
