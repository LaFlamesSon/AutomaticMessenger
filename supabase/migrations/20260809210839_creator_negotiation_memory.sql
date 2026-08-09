-- Durable creator-negotiation memory and media-kit commercial thresholds.
-- All access stays behind service-role authenticated Edge Functions.

create table if not exists ia_media_kit_rate_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references ia_users(id) on delete cascade,
  media_kit_id uuid not null references ia_media_kits(id) on delete cascade,
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  flat_fee_floor numeric(14,2) check (flat_fee_floor is null or flat_fee_floor >= 0),
  flat_fee_target numeric(14,2) check (flat_fee_target is null or flat_fee_target >= 0),
  commission_floor numeric(7,4) check (commission_floor is null or commission_floor between 0 and 100),
  commission_target numeric(7,4) check (commission_target is null or commission_target between 0 and 100),
  hybrid_guarantee_floor numeric(14,2) check (hybrid_guarantee_floor is null or hybrid_guarantee_floor >= 0),
  negotiation_notes text not null default '' check (char_length(negotiation_notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (media_kit_id),
  check (flat_fee_floor is null or flat_fee_target is null or flat_fee_target >= flat_fee_floor),
  check (commission_floor is null or commission_target is null or commission_target >= commission_floor)
);
create index if not exists ia_media_kit_rate_profiles_user_idx
  on ia_media_kit_rate_profiles(user_id, updated_at desc);

create table if not exists ia_negotiations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references ia_users(id) on delete cascade,
  gmail_account_id uuid not null references ia_gmail_accounts(id) on delete cascade,
  thread_id text not null,
  brand_name text not null,
  brand_domain text not null default '',
  stage text not null default 'offer_received'
    check (stage in ('offer_received','negotiating','countered','agreed','declined','closed')),
  media_kit_id uuid references ia_media_kits(id) on delete set null,
  current_terms jsonb not null default '{}'::jsonb,
  previous_terms jsonb,
  threshold_status text not null default 'unconfigured'
    check (threshold_status in ('below_minimum','within_range','at_or_above_target','insufficient_evidence','unconfigured')),
  attention_level text not null default 'critical'
    check (attention_level in ('critical','warning','normal')),
  human_review_required boolean not null default true,
  latest_message_id text,
  latest_subject text not null default '',
  summary text not null default '',
  last_inbound_at timestamptz not null default now(),
  is_test boolean not null default false,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gmail_account_id, thread_id),
  check (not is_test or thread_id like 'qa-negotiation:%')
);
create index if not exists ia_negotiations_user_attention_idx
  on ia_negotiations(user_id, human_review_required, updated_at desc);

create table if not exists ia_negotiation_events (
  id uuid primary key default gen_random_uuid(),
  negotiation_id uuid not null references ia_negotiations(id) on delete cascade,
  user_id uuid not null references ia_users(id) on delete cascade,
  gmail_message_id text not null,
  direction text not null default 'inbound' check (direction in ('inbound','outbound')),
  event_type text not null check (event_type in ('offer','counteroffer','terms_update','creator_decision','status_change')),
  terms jsonb not null default '{}'::jsonb,
  summary text not null default '',
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  unique (negotiation_id, gmail_message_id)
);
create index if not exists ia_negotiation_events_timeline_idx
  on ia_negotiation_events(negotiation_id, created_at desc);

alter table ia_processed_emails add column if not exists negotiation_id uuid;
alter table ia_processed_emails add column if not exists human_review_required boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ia_processed_emails_negotiation_fkey') then
    alter table ia_processed_emails add constraint ia_processed_emails_negotiation_fkey
      foreign key (negotiation_id) references ia_negotiations(id) on delete set null;
  end if;
end $$;
create index if not exists ia_processed_emails_negotiation_idx
  on ia_processed_emails(negotiation_id) where negotiation_id is not null;

alter table ia_media_kit_rate_profiles enable row level security;
alter table ia_negotiations enable row level security;
alter table ia_negotiation_events enable row level security;

revoke all on ia_media_kit_rate_profiles, ia_negotiations, ia_negotiation_events from public, anon, authenticated;
grant all on ia_media_kit_rate_profiles, ia_negotiations, ia_negotiation_events to service_role;
