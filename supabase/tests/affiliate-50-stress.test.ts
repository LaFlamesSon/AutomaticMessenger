import { assert, assertEquals } from "jsr:@std/assert";
import {
  matchAffiliateOpportunity,
  type AffiliateMatchResult,
  type AffiliateOpportunityInput,
  type CreatorCategoryMetric,
} from "../functions/_shared/affiliate.ts";

const kits = [
  { id: "fitness", label: "Fitness Kit", description: "fitness strength training gym activewear sports wellness yoga", keywords: ["fitness", "yoga", "workout"], is_default: false },
  { id: "beauty", label: "Beauty Kit", description: "beauty skincare makeup lashes cosmetics haircare serum", keywords: ["beauty", "skincare", "serum"], is_default: false },
  { id: "tech", label: "Tech Kit", description: "technology gadgets software electronics apps smartphone smart home", keywords: ["technology", "gadgets", "smartphone"], is_default: false },
  { id: "food", label: "Food Kit", description: "food recipes snacks beverages kitchen nutrition cooking", keywords: ["food", "snacks", "cooking"], is_default: false },
  { id: "gaming", label: "Gaming Kit", description: "gaming video games streaming esports consoles pc", keywords: ["gaming", "esports", "console"], is_default: false },
  { id: "finance", label: "Finance Kit", description: "finance budgeting investing banking fintech credit cards", keywords: ["finance", "investing", "credit card"], is_default: false },
  { id: "fashion", label: "Fashion Kit", description: "fashion clothing outfits accessories jewelry streetwear", keywords: ["fashion", "jewelry", "outfit"], is_default: false },
  { id: "travel", label: "Travel Kit", description: "travel hotels flights luggage tourism destinations", keywords: ["travel", "luggage", "hotel"], is_default: false },
  { id: "home", label: "Home Kit", description: "home decor furniture cleaning organization appliances", keywords: ["home", "home decor", "furniture", "appliance"], is_default: false },
  { id: "pets", label: "Pet Kit", description: "pets dogs cats pet care animal supplies treats", keywords: ["pets", "dog", "cat"], is_default: false },
  { id: "general", label: "General Kit", description: "general creator portfolio", is_default: true },
];

const categoryMetric = (category: string, id = category, overrides: Partial<CreatorCategoryMetric> = {}): CreatorCategoryMetric => ({
  id, platform: "tiktok", category, sample_size: 20, followers: 25_000, median_views: 12_000,
  engagement_rate: 0.055, click_through_rate: 0.035, conversion_rate: 0.025,
  ...overrides,
});

const preferences = (industry: string, overrides: Record<string, unknown> = {}) => ({
  industries: [industry], creator_styles: ["tutorial"], content_formats: ["review"],
  platforms: ["tiktok"], regions: ["US"], ...overrides,
});

const opportunity = (category: string, overrides: Partial<AffiliateOpportunityInput> = {}): AffiliateOpportunityInput => ({
  brand_name: `${category} brand`, brand_domain: `${category.replace(/[^a-z]/g, "")}.example`,
  product_name: `${category} product`, product_category: category,
  description: `${category} tutorial review`, tags: [category], affiliate_provider: "tiktok_shop",
  price_amount: 60, currency: "USD", commission_rate: 15, collaboration_model: "open",
  approval_required: false, sample_available: true, shipping_regions: ["US"],
  requirements: { min_followers: 1_000, required_platform: "tiktok" },
  product_metrics: { units_sold: 500 }, product_url: "https://shop.example/product",
  provider_verified: true, ...overrides,
});

type Scenario = {
  name: string;
  profile: Record<string, unknown>;
  metrics: CreatorCategoryMetric[];
  input: AffiliateOpportunityInput;
  check: (result: AffiliateMatchResult) => void;
};

const scenarios: Scenario[] = [];
const exactCategories = ["fitness", "beauty", "technology", "food", "gaming", "finance", "fashion", "travel", "home", "pets"];
const exactKit: Record<string, string> = { technology: "tech" };
for (const category of exactCategories) {
  scenarios.push({
    name: `exact ${category} match selects its metric and kit`,
    profile: preferences(category),
    metrics: [categoryMetric("unrelated", "distractor", { sample_size: 1_000 }), categoryMetric(category)],
    input: opportunity(category),
    check: (result) => {
      assert(result.score >= 75, `expected a strong score, got ${result.score}`);
      assertEquals(result.relevantMetric?.category, category);
      assertEquals(result.recommendedKit?.id, exactKit[category] ?? category);
    },
  });
}

const synonyms = [
  ["fitness", "yoga mat", "yoga", "fitness"],
  ["beauty", "vitamin c serum", "skincare serum", "beauty"],
  ["technology", "smartphone gimbal", "smartphone gadget", "tech"],
  ["food", "meal prep container", "cooking recipe", "food"],
  ["gaming", "esports controller", "esports console", "gaming"],
  ["finance", "credit card app", "credit card budgeting", "finance"],
  ["fashion", "gold necklace", "jewelry outfit", "fashion"],
  ["travel", "carry-on suitcase", "luggage hotel", "travel"],
  ["home", "modular sofa", "furniture home decor", "home"],
  ["pets", "dog treats", "dog animal supplies", "pets"],
] as const;
for (const [category, product, wording, kit] of synonyms) {
  scenarios.push({
    name: `${wording} maps to ${category} performance`,
    profile: preferences(category),
    metrics: [categoryMetric("unrelated", "large-distractor", { sample_size: 10_000 }), categoryMetric(category, `metric-${category}`)],
    input: opportunity(wording, { product_name: product, product_category: wording, description: `${wording} tutorial review`, tags: [wording] }),
    check: (result) => {
      assertEquals(result.relevantMetric?.category, category);
      assertEquals(result.recommendedKit?.id, kit);
      assert(result.components.content_fit >= 15, `expected semantic content fit, got ${result.components.content_fit}`);
    },
  });
}

const traps = [
  ["art", "smartwatch", "smartwatch wearable", "art", "tech"],
  ["pets", "carpet cleaner", "carpet stain remover", "pets", "general"],
  ["tea", "retail scanner", "retail point of sale", "tea", "general"],
  ["men", "supplement", "daily supplement capsules", "men", "general"],
  ["app", "apparel rack", "apparel clothing rack", "app", "fashion"],
] as const;
for (const [industry, product, wording, metricCategory, expectedKit] of traps) {
  scenarios.push({
    name: `${industry} does not falsely match ${wording}`,
    profile: preferences(industry), metrics: [categoryMetric(metricCategory)],
    input: opportunity(wording, { product_name: product, product_category: wording, description: `${wording} product`, tags: [] }),
    check: (result) => {
      assertEquals(result.relevantMetric, null);
      assertEquals(result.components.content_fit, 5);
      assertEquals(result.recommendedKit?.id, expectedKit);
    },
  });
}

const regionCases: Array<[string, string, boolean]> = [
  ["US", "US", true],
  ["United States", "US", true],
  ["UK", "GB", true],
  ["Canada", "CA", true],
  ["US", "Russia", false],
];
for (const [creatorRegion, shippingRegion, matches] of regionCases) {
  scenarios.push({
    name: `region ${creatorRegion} versus ${shippingRegion} is ${matches ? "eligible" : "ineligible"}`,
    profile: preferences("fitness", { regions: [creatorRegion] }), metrics: [categoryMetric("fitness")],
    input: opportunity("fitness", { shipping_regions: [shippingRegion] }),
    check: (result) => {
      assertEquals(result.components.audience_fit, matches ? 20 : 0);
      assertEquals(result.easeReasons.includes("Shipping region mismatch"), !matches);
    },
  });
}

const easeCases: Scenario[] = [
  {
    name: "open verified offer with sample and link is easy", profile: preferences("fitness"), metrics: [categoryMetric("fitness")], input: opportunity("fitness"),
    check: (result) => assertEquals(result.easeLabel, "easy"),
  },
  {
    name: "approval and no sample make an offer moderate", profile: preferences("fitness"), metrics: [categoryMetric("fitness")],
    input: opportunity("fitness", { approval_required: true, sample_available: false }), check: (result) => assertEquals(result.easeLabel, "moderate"),
  },
  {
    name: "targeted approval with no sample remains moderate", profile: preferences("fitness"), metrics: [categoryMetric("fitness")],
    input: opportunity("fitness", { collaboration_model: "targeted", approval_required: true, sample_available: false }), check: (result) => assertEquals(result.easeLabel, "moderate"),
  },
  {
    name: "multiple hard eligibility failures are competitive", profile: preferences("fitness", { regions: ["US"], platforms: ["instagram"] }), metrics: [categoryMetric("fitness", "ig", { platform: "instagram", followers: 500 })],
    input: opportunity("fitness", { shipping_regions: ["GB"], requirements: { min_followers: 50_000, required_platform: "tiktok" }, approval_required: true }),
    check: (result) => assertEquals(result.easeLabel, "competitive"),
  },
  {
    name: "required-platform followers cannot borrow from another platform", profile: preferences("fitness", { platforms: ["tiktok", "youtube"] }),
    metrics: [categoryMetric("fitness", "youtube-large", { platform: "youtube", followers: 1_000_000 }), categoryMetric("fitness", "tiktok-small", { platform: "tiktok", followers: 900 })],
    input: opportunity("fitness", { requirements: { min_followers: 10_000, required_platform: "tiktok" }, approval_required: true, sample_available: false, collaboration_model: "targeted" }),
    check: (result) => {
      assertEquals(result.easeLabel, "competitive");
      assert(result.easeReasons.some((reason) => reason.includes("followers")));
    },
  },
];
scenarios.push(...easeCases);

const earningsCases: Scenario[] = [
  {
    name: "complete mature performance produces high-confidence earnings", profile: preferences("fitness"), metrics: [categoryMetric("fitness", "mature", { sample_size: 30 })], input: opportunity("fitness"),
    check: (result) => { assert(result.estimatedEarningsLow !== null); assertEquals(result.earningsConfidence, "high"); },
  },
  {
    name: "small performance sample produces medium-confidence earnings", profile: preferences("fitness"), metrics: [categoryMetric("fitness", "small", { sample_size: 3 })], input: opportunity("fitness"),
    check: (result) => { assert(result.estimatedEarningsHigh !== null); assertEquals(result.earningsConfidence, "medium"); },
  },
  {
    name: "RPM fallback is explicitly low confidence", profile: preferences("fitness"), metrics: [categoryMetric("fitness", "rpm", { click_through_rate: null, conversion_rate: null, revenue_per_thousand_views: 8 })], input: opportunity("fitness"),
    check: (result) => { assert(result.estimatedEarningsLow !== null); assertEquals(result.earningsConfidence, "low"); },
  },
  {
    name: "missing commission suppresses earnings estimate", profile: preferences("fitness"), metrics: [categoryMetric("fitness")], input: opportunity("fitness", { price_amount: null, commission_rate: null, commission_amount: null }),
    check: (result) => { assertEquals(result.estimatedEarningsLow, null); assertEquals(result.earningsConfidence, null); },
  },
  {
    name: "missing conversion evidence suppresses earnings estimate", profile: preferences("fitness"), metrics: [categoryMetric("fitness", "no-conversion", { conversion_rate: null, revenue_per_thousand_views: null })], input: opportunity("fitness"),
    check: (result) => { assertEquals(result.estimatedEarningsHigh, null); assertEquals(result.earningsConfidence, null); },
  },
];
scenarios.push(...earningsCases);

const boundaryCases: Scenario[] = [
  {
    name: "excluded domain is never recommended", profile: preferences("fitness", { excluded_brands: ["blocked.example"] }), metrics: [categoryMetric("fitness")], input: opportunity("fitness", { brand_domain: "blocked.example" }),
    check: (result) => { assertEquals(result.excluded, true); assertEquals(result.score, 0); assertEquals(result.recommendedKit, null); },
  },
  {
    name: "excluded exact brand is never recommended", profile: preferences("fitness", { excluded_brands: ["No Thanks"] }), metrics: [categoryMetric("fitness")], input: opportunity("fitness", { brand_name: "No Thanks" }),
    check: (result) => assertEquals(result.excluded, true),
  },
  {
    name: "similar brand name does not trigger exact exclusion", profile: preferences("fitness", { excluded_brands: ["Glow"] }), metrics: [categoryMetric("fitness")], input: opportunity("fitness", { brand_name: "Glow Up" }),
    check: (result) => assertEquals(result.excluded, false),
  },
  {
    name: "blocked relationship is never recommended", profile: preferences("fitness"), metrics: [categoryMetric("fitness")], input: opportunity("fitness", { relationship_status: "blocked" }),
    check: (result) => { assertEquals(result.excluded, true); assertEquals(result.score, 0); },
  },
  {
    name: "unknown niche uses the general media kit", profile: preferences("fitness"), metrics: [categoryMetric("fitness")], input: opportunity("pottery", { product_name: "ceramic wheel", description: "pottery ceramics", tags: [] }),
    check: (result) => { assertEquals(result.recommendedKit?.id, "general"); assert(result.score < 70); },
  },
];
scenarios.push(...boundaryCases);

const rankingCases: Scenario[] = [
  {
    name: "strong category fit outranks an unrelated product", profile: preferences("fitness"), metrics: [categoryMetric("fitness")], input: opportunity("fitness"),
    check: (result) => {
      const unrelated = matchAffiliateOpportunity(preferences("fitness"), kits, [categoryMetric("fitness")], opportunity("pottery", { description: "ceramic wheel", tags: [] }));
      assert(result.score >= unrelated.score + 20, `${result.score} should decisively beat ${unrelated.score}`);
    },
  },
  {
    name: "strong commission outranks weak commission on economics", profile: preferences("fitness"), metrics: [categoryMetric("fitness")], input: opportunity("fitness", { commission_rate: 25 }),
    check: (result) => {
      const weak = matchAffiliateOpportunity(preferences("fitness"), kits, [categoryMetric("fitness")], opportunity("fitness", { commission_rate: 2 }));
      assert(result.components.economics > weak.components.economics);
    },
  },
  {
    name: "verified evidence increases confidence but not content fit", profile: preferences("fitness"), metrics: [categoryMetric("fitness")], input: opportunity("fitness", { provider_verified: true }),
    check: (result) => {
      const unverified = matchAffiliateOpportunity(preferences("fitness"), kits, [categoryMetric("fitness")], opportunity("fitness", { provider_verified: false }));
      assert(result.components.confidence > unverified.components.confidence);
      assertEquals(result.components.content_fit, unverified.components.content_fit);
    },
  },
  {
    name: "easy and hard variants keep fit separate from difficulty", profile: preferences("fitness"), metrics: [categoryMetric("fitness")], input: opportunity("fitness"),
    check: (result) => {
      const hard = matchAffiliateOpportunity(preferences("fitness", { regions: ["US"] }), kits, [categoryMetric("fitness", "small", { followers: 100 })], opportunity("fitness", {
        shipping_regions: ["GB"], approval_required: true, sample_available: false, collaboration_model: "targeted",
        requirements: { min_followers: 100_000, required_platform: "tiktok" },
      }));
      assertEquals(result.components.content_fit, hard.components.content_fit);
      assert(result.easeScore >= hard.easeScore + 50);
    },
  },
  {
    name: "category performance changes earnings without leaking another niche", profile: preferences("fitness"), metrics: [
      categoryMetric("beauty", "beauty-large", { median_views: 1_000_000 }), categoryMetric("fitness", "fitness-real", { median_views: 10_000 }),
    ], input: opportunity("fitness"),
    check: (result) => {
      assertEquals(result.relevantMetric?.id, "fitness-real");
      assert(result.estimatedEarningsHigh !== null && result.estimatedEarningsHigh < 1_000);
    },
  },
];
scenarios.push(...rankingCases);

assertEquals(scenarios.length, 50);

for (const scenario of scenarios) {
  Deno.test(`affiliate stress: ${scenario.name}`, () => {
    const result = matchAffiliateOpportunity(scenario.profile, kits, scenario.metrics, scenario.input);
    scenario.check(result);
  });
}
