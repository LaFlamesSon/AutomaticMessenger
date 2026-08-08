-- Evidence-backed channel requirements and creator-specific recommendations.
-- Provider evidence is kept separate from CaughtUp's per-creator recommendation
-- so the UI never presents an inferred channel as a brand requirement.

alter table ia_opportunities
  add column allowed_platforms text[] not null default array[]::text[]
    check (allowed_platforms <@ array['tiktok', 'instagram', 'youtube', 'facebook', 'pinterest']::text[]),
  add column required_platform text
    check (required_platform is null or required_platform in ('tiktok', 'instagram', 'youtube', 'facebook', 'pinterest')),
  add column recommended_platform text
    check (recommended_platform is null or recommended_platform in ('tiktok', 'instagram', 'youtube', 'facebook', 'pinterest')),
  add column platform_recommendation_basis text
    check (platform_recommendation_basis is null or platform_recommendation_basis in
      ('brand_required', 'provider_native', 'creator_performance', 'creator_preference', 'brand_allowed')),
  add column platform_reasons jsonb not null default '[]'::jsonb
    check (jsonb_typeof(platform_reasons) = 'array'),
  add column platform_eligible boolean not null default true,
  add column creator_relevant boolean not null default false,
  add column channel_evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(channel_evidence) = 'object');

update ia_opportunities
set allowed_platforms = array['tiktok']::text[],
    required_platform = 'tiktok',
    channel_evidence = jsonb_build_object('provider_native', true, 'provider', 'tiktok_shop')
where opportunity_kind = 'affiliate_product'
  and affiliate_provider = 'tiktok_shop';

create index ia_opportunities_creator_platform_idx
  on ia_opportunities (user_id, recommended_platform, match_score desc)
  where opportunity_kind = 'affiliate_product'
    and creator_relevant
    and platform_eligible
    and recommended_platform is not null;
