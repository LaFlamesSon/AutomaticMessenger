-- Affiliate opportunity API: provider-ready connections, private creator
-- performance metrics, product economics, and explainable match/ease scores.
-- Provider credentials are referenced by Vault secret id and never stored here.

alter table ia_opportunity_preferences
  add column content_formats text[] not null default array[]::text[];

alter table ia_opportunities
  add column opportunity_kind text not null default 'brand'
    check (opportunity_kind in ('brand', 'affiliate_product')),
  add column affiliate_provider text
    check (affiliate_provider is null or affiliate_provider in
      ('manual', 'tiktok_shop', 'awin', 'cj', 'rakuten', 'amazon', 'ebay', 'impact')),
  add column provider_opportunity_id text
    check (provider_opportunity_id is null or char_length(provider_opportunity_id) <= 300),
  add column product_name text not null default '' check (char_length(product_name) <= 300),
  add column product_category text not null default '' check (char_length(product_category) <= 160),
  add column product_url text check (product_url is null or (char_length(product_url) <= 1000 and product_url ~ '^https://')),
  add column price_amount numeric(14,2) check (price_amount is null or price_amount >= 0),
  add column currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  add column commission_rate numeric(7,4) check (commission_rate is null or commission_rate between 0 and 100),
  add column commission_amount numeric(14,2) check (commission_amount is null or commission_amount >= 0),
  add column collaboration_model text
    check (collaboration_model is null or collaboration_model in ('open', 'targeted', 'program')),
  add column approval_required boolean not null default false,
  add column sample_available boolean,
  add column shipping_regions text[] not null default array[]::text[],
  add column requirements jsonb not null default '{}'::jsonb check (jsonb_typeof(requirements) = 'object'),
  add column product_metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(product_metrics) = 'object'),
  add column ease_score smallint not null default 0 check (ease_score between 0 and 100),
  add column ease_label text check (ease_label is null or ease_label in ('easy', 'moderate', 'competitive')),
  add column ease_reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(ease_reasons) = 'array'),
  add column score_components jsonb not null default '{}'::jsonb check (jsonb_typeof(score_components) = 'object'),
  add column relevant_metric_id uuid,
  add column estimated_earnings_low numeric(14,2) check (estimated_earnings_low is null or estimated_earnings_low >= 0),
  add column estimated_earnings_high numeric(14,2) check (estimated_earnings_high is null or estimated_earnings_high >= 0),
  add column earnings_confidence text
    check (earnings_confidence is null or earnings_confidence in ('low', 'medium', 'high'));

create table ia_creator_category_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references ia_users(id) on delete cascade,
  platform text not null check (platform in ('tiktok', 'instagram', 'youtube', 'other')),
  category text not null check (char_length(category) between 2 and 160),
  sample_size integer not null default 0 check (sample_size between 0 and 1000000),
  followers bigint check (followers is null or followers between 0 and 10000000000),
  median_views bigint check (median_views is null or median_views between 0 and 10000000000),
  engagement_rate numeric(8,7) check (engagement_rate is null or engagement_rate between 0 and 1),
  click_through_rate numeric(8,7) check (click_through_rate is null or click_through_rate between 0 and 1),
  conversion_rate numeric(8,7) check (conversion_rate is null or conversion_rate between 0 and 1),
  revenue_per_thousand_views numeric(14,2)
    check (revenue_per_thousand_views is null or revenue_per_thousand_views >= 0),
  source_type text not null default 'manual' check (source_type in ('manual', 'provider')),
  source_ref text not null check (char_length(source_ref) between 1 and 300),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, platform, category, source_ref)
);

alter table ia_opportunities
  add constraint ia_opportunities_relevant_metric_fk
  foreign key (relevant_metric_id) references ia_creator_category_metrics(id) on delete set null;

create table ia_affiliate_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references ia_users(id) on delete cascade,
  provider text not null check (provider in
    ('tiktok_shop', 'awin', 'cj', 'rakuten', 'amazon', 'ebay', 'impact')),
  external_account_ref text not null check (char_length(external_account_ref) between 1 and 300),
  status text not null default 'pending'
    check (status in ('pending', 'connected', 'reauthorize', 'disabled')),
  credential_secret_id uuid,
  scopes text[] not null default array[]::text[],
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  sync_cursor text check (sync_cursor is null or char_length(sync_cursor) <= 2000),
  last_synced_at timestamptz,
  error_code text check (error_code is null or char_length(error_code) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, external_account_ref),
  check (status <> 'connected' or credential_secret_id is not null)
);

create index ia_creator_category_metrics_user_idx
  on ia_creator_category_metrics (user_id, platform, category, observed_at desc);
create index ia_affiliate_connections_user_status_idx
  on ia_affiliate_connections (user_id, status, provider);
create index ia_opportunities_affiliate_rank_idx
  on ia_opportunities (user_id, opportunity_kind, status, match_score desc, ease_score desc)
  where opportunity_kind = 'affiliate_product';

alter table ia_creator_category_metrics enable row level security;
alter table ia_affiliate_connections enable row level security;

revoke all on ia_creator_category_metrics, ia_affiliate_connections
  from public, anon, authenticated;
grant all on ia_creator_category_metrics, ia_affiliate_connections
  to service_role;
