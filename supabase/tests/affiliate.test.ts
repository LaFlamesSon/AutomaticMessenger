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
