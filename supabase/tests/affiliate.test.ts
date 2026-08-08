import { assert, assertEquals } from "jsr:@std/assert";
import { matchAffiliateOpportunity } from "../functions/_shared/affiliate.ts";

const kits = [
  { id: "fitness", label: "Fitness Kit", description: "fitness gym activewear", keywords: ["fitness"], is_default: false },
  { id: "beauty", label: "Beauty Kit", description: "beauty skincare makeup", keywords: ["beauty"], is_default: false },
  { id: "general", label: "General Kit", description: "general creator", is_default: true },
];

Deno.test("affiliate matching separates fit, ease, and category-specific performance", () => {
  const result = matchAffiliateOpportunity(
    { industries: ["fitness"], creator_styles: ["tutorial"], content_formats: ["review"], platforms: ["TikTok"], regions: ["US"] },
    kits,
    [{ id: "metric-1", platform: "tiktok", category: "fitness", sample_size: 12, followers: 25_000,
      median_views: 10_000, engagement_rate: 0.06, click_through_rate: 0.04, conversion_rate: 0.03 }],
    { brand_name: "PulseFit", brand_domain: "pulsefit.com", product_name: "Resistance bands", product_category: "fitness",
      description: "Fitness tutorial and review product", affiliate_provider: "tiktok_shop", price_amount: 50,
      currency: "USD", commission_rate: 20, collaboration_model: "open", approval_required: false,
      sample_available: true, shipping_regions: ["US"], requirements: { min_followers: 1000 },
      product_metrics: { units_sold: 250 }, product_url: "https://shop.tiktok.com/item/1", provider_verified: true },
  );
  assert(result.score >= 80);
  assertEquals(result.easeLabel, "easy");
  assertEquals(result.relevantMetric?.id, "metric-1");
  assertEquals(result.recommendedKit?.id, "fitness");
  assert(result.estimatedEarningsLow !== null && result.estimatedEarningsHigh !== null);
  assert(result.components.historical_performance > 0);
});
Deno.test("high fit can remain competitive when eligibility and shipping fail", () => {
  const result = matchAffiliateOpportunity(
    { industries: ["beauty"], platforms: ["Instagram"], regions: ["US"] }, kits,
    [{ platform: "instagram", category: "beauty", followers: 900, median_views: 2000, engagement_rate: 0.04 }],
    { brand_name: "Glow", brand_domain: "glow.example", product_name: "Serum", product_category: "beauty",
      affiliate_provider: "tiktok_shop", approval_required: true, sample_available: false,
      collaboration_model: "targeted", shipping_regions: ["GB"], requirements: { min_followers: 10_000, required_platform: "tiktok" } },
  );
  assert(result.components.content_fit > 0);
  assertEquals(result.easeLabel, "competitive");
  assert(result.easeReasons.some((reason) => reason.includes("followers")));
  assertEquals(result.estimatedEarningsLow, null);
});

Deno.test("excluded affiliate brands never receive a recommendation", () => {
  const result = matchAffiliateOpportunity(
    { excluded_brands: ["blocked.example"] }, kits, [],
    { brand_name: "Blocked", brand_domain: "blocked.example", product_name: "Product" },
  );
  assertEquals(result.score, 0);
  assertEquals(result.excluded, true);
  assertEquals(result.recommendedKit, null);
});

Deno.test("the same Awin product routes to each creator's strongest eligible platform", () => {
  const product = {
    brand_name: "MoveWell", brand_domain: "movewell.example", product_name: "Resistance bands",
    product_category: "fitness", affiliate_provider: "awin", allowed_platforms: ["tiktok", "instagram"],
    commission_rate: 12, provider_verified: true,
  };
  const tiktokCreator = matchAffiliateOpportunity(
    { industries: ["fitness"], platforms: ["TikTok", "Instagram"] }, kits,
    [
      { platform: "tiktok", category: "fitness", sample_size: 20, median_views: 20_000, engagement_rate: 0.06 },
      { platform: "instagram", category: "fitness", sample_size: 20, median_views: 2_000, engagement_rate: 0.02 },
    ], product,
  );
  const instagramCreator = matchAffiliateOpportunity(
    { industries: ["fitness"], platforms: ["TikTok", "Instagram"] }, kits,
    [
      { platform: "tiktok", category: "fitness", sample_size: 20, median_views: 1_000, engagement_rate: 0.01 },
      { platform: "instagram", category: "fitness", sample_size: 20, median_views: 30_000, engagement_rate: 0.07 },
    ], product,
  );
  assertEquals(tiktokCreator.recommendedPlatform, "tiktok");
  assertEquals(tiktokCreator.platformBasis, "creator_performance");
  assertEquals(instagramCreator.recommendedPlatform, "instagram");
});

Deno.test("brand-required and provider-native platforms are authoritative", () => {
  const required = matchAffiliateOpportunity(
    { industries: ["beauty"], platforms: ["Instagram", "TikTok"] }, kits,
    [{ platform: "instagram", category: "beauty", median_views: 100_000 }],
    { brand_name: "Glow", brand_domain: "glow.example", product_name: "Serum", product_category: "beauty",
      affiliate_provider: "awin", required_platform: "tiktok", allowed_platforms: ["tiktok"], commission_rate: 10 },
  );
  assertEquals(required.recommendedPlatform, "tiktok");
  assertEquals(required.platformBasis, "brand_required");
  const native = matchAffiliateOpportunity(
    { industries: ["beauty"], platforms: ["TikTok"] }, kits, [],
    { brand_name: "Glow", brand_domain: "glow.example", product_name: "Serum", product_category: "beauty",
      affiliate_provider: "tiktok_shop", commission_rate: 10 },
  );
  assertEquals(native.recommendedPlatform, "tiktok");
  assertEquals(native.platformBasis, "provider_native");
});

Deno.test("a creator is not recommended an unavailable required platform", () => {
  const result = matchAffiliateOpportunity(
    { industries: ["beauty"], platforms: ["Instagram"] }, kits, [],
    { brand_name: "Glow", brand_domain: "glow.example", product_name: "Serum", product_category: "beauty",
      affiliate_provider: "awin", required_platform: "tiktok", allowed_platforms: ["tiktok"], commission_rate: 10 },
  );
  assertEquals(result.platformEligible, false);
  assertEquals(result.recommendedPlatform, null);
});

Deno.test("high commission alone does not make an unrelated product relevant", () => {
  const unrelated = matchAffiliateOpportunity(
    { industries: ["fitness"], platforms: ["TikTok"] }, kits, [],
    { brand_name: "LedgerPro", brand_domain: "ledger.example", product_name: "Business tax software",
      product_category: "finance", affiliate_provider: "awin", allowed_platforms: ["tiktok"], commission_rate: 50 },
  );
  assertEquals(unrelated.creatorRelevant, false);
  const desired = matchAffiliateOpportunity(
    { industries: ["fitness"], platforms: ["TikTok"], desired_brands: ["LedgerPro"] }, kits, [],
    { brand_name: "LedgerPro", brand_domain: "ledger.example", product_name: "Business tax software",
      product_category: "finance", affiliate_provider: "awin", allowed_platforms: ["tiktok"], commission_rate: 50 },
  );
  assertEquals(desired.creatorRelevant, true);
});
