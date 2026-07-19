-- Inbox Agent — Phase 0 schema
-- All tables are service-role-only: RLS is enabled with NO policies, so the
-- anon/authenticated keys can't touch them. Edge Functions use the service key.

create table if not exists ia_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists ia_gmail_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references ia_users(id) on delete cascade,
  gmail_address text not null unique,
  refresh_token text not null,
  connected_at timestamptz not null default now(),
  last_sweep_at timestamptz
);

create table if not exists ia_voice_profiles (
  user_id uuid primary key references ia_users(id) on delete cascade,
  display_name text not null default '',
  occupation text not null default 'a freelance professional',
  services text not null default '',
  tone text not null default 'warm, confident, direct. Short sentences. No corporate filler.',
  signoff text not null default 'Best',
  always_ask text[] not null default array['project scope','budget range','timeline','what brand materials they already have'],
  custom_rules text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists ia_processed_emails (
  id uuid primary key default gen_random_uuid(),
  gmail_account_id uuid not null references ia_gmail_accounts(id) on delete cascade,
  gmail_message_id text not null,
  thread_id text not null,
  category text not null check (category in ('urgent','action_needed','fyi','low_priority','spam_or_poor_fit')),
  summary text not null,
  draft_created boolean not null default false,
  sender text not null default '',
  subject text not null default '',
  processed_at timestamptz not null default now(),
  unique (gmail_account_id, gmail_message_id)
);

-- Style memory: before/after pairs captured when the user edits a draft.
create table if not exists ia_draft_edits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references ia_users(id) on delete cascade,
  original_draft text not null,
  edited_final text not null,
  created_at timestamptz not null default now()
);

create table if not exists ia_agent_runs (
  id uuid primary key default gen_random_uuid(),
  gmail_account_id uuid references ia_gmail_accounts(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  emails_scanned int not null default 0,
  drafts_created int not null default 0,
  status text not null default 'running' check (status in ('running','ok','error')),
  error text
);

create index if not exists ia_processed_emails_account_idx on ia_processed_emails (gmail_account_id, processed_at desc);
create index if not exists ia_draft_edits_user_idx on ia_draft_edits (user_id, created_at desc);

alter table ia_users enable row level security;
alter table ia_gmail_accounts enable row level security;
alter table ia_voice_profiles enable row level security;
alter table ia_processed_emails enable row level security;
alter table ia_draft_edits enable row level security;
alter table ia_agent_runs enable row level security;
