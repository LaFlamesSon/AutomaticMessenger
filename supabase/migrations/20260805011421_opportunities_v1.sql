-- Opportunities v1: creator profile, brand relationships, evidence-based
-- matching, approval-only Gmail drafts, and auditable state transitions.
-- All access remains service-role-only through authenticated Edge Functions.

create table ia_opportunity_preferences (
  user_id uuid primary key references ia_users(id) on delete cascade,
  enabled boolean not null default false,
  creator_styles text[] not null default array[]::text[],
  industries text[] not null default array[]::text[],
  platforms text[] not null default array[]::text[],
  collaboration_types text[] not null default array[]::text[],
  regions text[] not null default array[]::text[],
  desired_brands text[] not null default array[]::text[],
  excluded_brands text[] not null default array[]::text[],
  settings_version bigint not null default 1 check (settings_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ia_brand_relationships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references ia_users(id) on delete cascade,
  brand_name text not null check (char_length(brand_name) between 1 and 120),
  brand_domain text not null check (char_length(brand_domain) between 3 and 253),
  relationship_status text not null default 'suggested'
    check (relationship_status in ('suggested', 'contacted', 'worked_with', 'want_to_work_with', 'dream', 'not_interested', 'blocked')),
  collaboration_types text[] not null default array[]::text[],
  notes text not null default '' check (char_length(notes) <= 1000),
  source_type text not null default 'manual' check (source_type in ('manual', 'gmail', 'opportunity')),
  source_ref text not null check (char_length(source_ref) between 1 and 500),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  confirmed boolean not null default false,
  last_contact_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, brand_domain)
);

create table ia_opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references ia_users(id) on delete cascade,
  brand_name text not null check (char_length(brand_name) between 1 and 120),
  brand_domain text not null check (char_length(brand_domain) between 3 and 253),
  contact_email text check (contact_email is null or char_length(contact_email) <= 320),
  title text not null default '' check (char_length(title) <= 200),
  description text not null default '' check (char_length(description) <= 2000),
  tags text[] not null default array[]::text[],
  source_type text not null check (source_type in ('manual', 'gmail', 'public_page', 'marketplace')),
  source_ref text not null check (char_length(source_ref) between 1 and 500),
  source_url text check (source_url is null or char_length(source_url) <= 1000),
  source_published_at timestamptz,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  match_score smallint not null default 0 check (match_score between 0 and 100),
  match_reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(match_reasons) = 'array'),
  recommended_media_kit_id uuid references ia_media_kits(id) on delete set null,
  status text not null default 'new'
    check (status in ('new', 'saved', 'dismissed', 'drafted', 'contacted', 'replied')),
  gmail_draft_id text,
  gmail_draft_message_id text,
  draft_to text,
  draft_subject text,
  draft_body text,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_type, source_ref)
);

create table ia_opportunity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references ia_users(id) on delete cascade,
  opportunity_id uuid not null references ia_opportunities(id) on delete cascade,
  event_type text not null
    check (event_type in ('discovered', 'matched', 'saved', 'dismissed', 'drafted', 'send_claimed', 'sent', 'send_failed', 'replied', 'refreshed')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create table ia_opportunity_send_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references ia_users(id) on delete cascade,
  opportunity_id uuid not null references ia_opportunities(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  status text not null default 'claimed' check (status in ('claimed', 'sending', 'sent', 'failed', 'reconcile')),
  gmail_message_id text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create index ia_opportunity_preferences_enabled_idx
  on ia_opportunity_preferences (enabled, updated_at desc) where enabled;
create index ia_brand_relationships_user_status_idx
  on ia_brand_relationships (user_id, relationship_status, updated_at desc);
create index ia_opportunities_user_status_idx
  on ia_opportunities (user_id, status, match_score desc, updated_at desc);
create index ia_opportunities_recommended_kit_idx
  on ia_opportunities (recommended_media_kit_id) where recommended_media_kit_id is not null;
create index ia_opportunity_events_opportunity_created_idx
  on ia_opportunity_events (opportunity_id, created_at desc);
create index ia_opportunity_events_user_created_idx
  on ia_opportunity_events (user_id, created_at desc);
create unique index ia_opportunity_send_attempts_active_uidx
  on ia_opportunity_send_attempts (opportunity_id)
  where status in ('claimed', 'sending', 'sent', 'reconcile');

alter table ia_opportunity_preferences enable row level security;
alter table ia_brand_relationships enable row level security;
alter table ia_opportunities enable row level security;
alter table ia_opportunity_events enable row level security;
alter table ia_opportunity_send_attempts enable row level security;

revoke all on ia_opportunity_preferences, ia_brand_relationships,
  ia_opportunities, ia_opportunity_events, ia_opportunity_send_attempts
  from public, anon, authenticated;
grant all on ia_opportunity_preferences, ia_brand_relationships,
  ia_opportunities, ia_opportunity_events, ia_opportunity_send_attempts
  to service_role;
