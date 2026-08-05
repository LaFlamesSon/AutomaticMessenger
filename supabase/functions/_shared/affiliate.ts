import { matchOpportunity, type OpportunityMatchInput } from "./opportunities.ts";
import type { MediaKitCandidate } from "./policy.ts";

export const AFFILIATE_PROVIDERS = [
  "manual", "tiktok_shop", "awin", "cj", "rakuten", "amazon", "ebay", "impact",
] as const;

export interface CreatorCategoryMetric {
  id?: string;
  platform: string;
  category: string;
  sample_size?: number | null;
  followers?: number | null;
  median_views?: number | null;
  engagement_rate?: number | null;
  click_through_rate?: number | null;
  conversion_rate?: number | null;
  revenue_per_thousand_views?: number | null;
}
export interface AffiliateOpportunityInput extends OpportunityMatchInput {
  affiliate_provider?: string | null;
  product_name: string;
  product_category?: string;
  price_amount?: number | null;
  currency?: string | null;
  commission_rate?: number | null;
  commission_amount?: number | null;
  collaboration_model?: string | null;
  approval_required?: boolean;
  sample_available?: boolean | null;
  shipping_regions?: string[];
  requirements?: Record<string, unknown>;
  product_metrics?: Record<string, unknown>;
  product_url?: string | null;
  provider_verified?: boolean;
}

export interface AffiliateMatchResult {
  score: number;
  reasons: string[];
  recommendedKit: MediaKitCandidate | null;
  excluded: boolean;
  components: Record<string, number>;
  easeScore: number;
  easeLabel: "easy" | "moderate" | "competitive";
  easeReasons: string[];
  relevantMetric: CreatorCategoryMetric | null;
  estimatedEarningsLow: number | null;
  estimatedEarningsHigh: number | null;
  earningsConfidence: "low" | "medium" | "high" | null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

const CATEGORY_TERMS: Record<string, string[]> = {
  fitness: ["fitness", "workout", "workouts", "gym", "yoga", "exercise", "activewear", "sports"],
  beauty: ["beauty", "skincare", "skin care", "serum", "makeup", "cosmetic", "cosmetics", "lashes", "eyelash", "haircare"],
  technology: ["technology", "tech", "gadget", "gadgets", "smartphone", "electronics", "software", "app", "apps"],
  food: ["food", "cooking", "recipe", "recipes", "snack", "snacks", "beverage", "beverages", "kitchen", "meal prep"],
  gaming: ["gaming", "video game", "video games", "esports", "console", "consoles", "pc gaming"],
  finance: ["finance", "financial", "budgeting", "investing", "banking", "fintech", "credit card", "credit cards"],
  fashion: ["fashion", "clothing", "outfit", "outfits", "accessories", "jewelry", "streetwear", "apparel"],
  travel: ["travel", "hotel", "hotels", "flight", "flights", "luggage", "tourism", "destination", "destinations"],
  home: ["home", "home decor", "decor", "furniture", "cleaning", "organization", "appliance", "appliances"],
  pets: ["pet", "pets", "dog", "dogs", "cat", "cats", "pet care", "animal supplies", "dog treats"],
};

function normalizedPhrase(value: unknown): string {
  return text(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function containsPhrase(haystack: string, needle: string): boolean {
  const normalizedNeedle = normalizedPhrase(needle);
  return normalizedNeedle.length >= 2 && ` ${normalizedPhrase(haystack)} `.includes(` ${normalizedNeedle} `);
}

function categoryTerms(value: string): string[] {
  const normalized = normalizedPhrase(value);
  const canonical = Object.entries(CATEGORY_TERMS)
    .find(([name, aliases]) => name === normalized || aliases.some((alias) => normalizedPhrase(alias) === normalized));
  return canonical ? [canonical[0], ...canonical[1]] : [normalized];
}

function containsCategory(haystack: string, value: string): boolean {
  return categoryTerms(value).some((term) => containsPhrase(haystack, term));
}

function containsAny(haystack: string, values: unknown, semanticCategories = false): string[] {
  return list(values).filter((value) => semanticCategories ? containsCategory(haystack, value) : containsPhrase(haystack, value));
}

function platformKey(value: unknown): string {
  const normalized = normalizedPhrase(value);
  if (["tiktok", "tik tok", "tiktok shop"].includes(normalized)) return "tiktok";
  if (["instagram", "ig"].includes(normalized)) return "instagram";
  if (["youtube", "you tube", "youtube shorts"].includes(normalized)) return "youtube";
  return normalized;
}

function regionKey(value: unknown): string {
  const normalized = normalizedPhrase(value);
  if (["us", "usa", "united states", "united states of america"].includes(normalized)) return "US";
  if (["uk", "gb", "gbr", "united kingdom", "great britain"].includes(normalized)) return "GB";
  if (["ca", "can", "canada"].includes(normalized)) return "CA";
  if (["au", "aus", "australia"].includes(normalized)) return "AU";
  return normalized.toLocaleUpperCase();
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function chooseRelevantMetric(
  metrics: CreatorCategoryMetric[],
  opportunityText: string,
  provider: string,
): CreatorCategoryMetric | null {
  let best: CreatorCategoryMetric | null = null;
  let bestScore = -1;
  for (const metric of metrics) {
    const category = text(metric.category);
    const platform = platformKey(metric.platform);
    if (!category || !containsCategory(opportunityText, category)) continue;
    let score = 8;
    if (platform && ((provider === "tiktok_shop" && platform === "tiktok") || containsPhrase(opportunityText, platform))) score += 4;
    score += Math.min(3, Math.log10(Math.max(1, finite(metric.sample_size) ?? 0) + 1));
    if (score > bestScore) { best = metric; bestScore = score; }
  }
  return bestScore >= 8 ? best : null;
}

export function matchAffiliateOpportunity(
  preferences: Record<string, unknown> | null,
  kits: MediaKitCandidate[],
  metrics: CreatorCategoryMetric[],
  opportunity: AffiliateOpportunityInput,
): AffiliateMatchResult {
  const base = matchOpportunity(preferences, kits, opportunity);
  if (base.excluded) {
    return {
      score: 0, reasons: base.reasons, recommendedKit: null, excluded: true,
      components: { content_fit: 0, audience_fit: 0, historical_performance: 0, economics: 0, platform_fit: 0, confidence: 0 },
      easeScore: 0, easeLabel: "competitive", easeReasons: ["Excluded by the creator"], relevantMetric: null,
      estimatedEarningsLow: null, estimatedEarningsHigh: null, earningsConfidence: null,
    };
  }

  const provider = text(opportunity.affiliate_provider) || "manual";
  const opportunityText = [
    opportunity.brand_name, opportunity.product_name, opportunity.product_category,
    opportunity.title, opportunity.description, ...(opportunity.tags ?? []),
  ].map(text).join(" ");
  const industryMatches = containsAny(opportunityText, preferences?.industries, true);
  const styleMatches = containsAny(opportunityText, preferences?.creator_styles);
  const formatMatches = containsAny(opportunityText, preferences?.content_formats);
  const desiredMatches = containsAny(opportunityText, preferences?.desired_brands);
  const contentFit = clamp(5 + Math.min(20, industryMatches.length * 10) + Math.min(8, styleMatches.length * 4) +
    Math.min(7, formatMatches.length * 4) + (desiredMatches.length ? 5 : 0), 0, 35);

  const creatorRegions = list(preferences?.regions);
  const shippingRegions = list(opportunity.shipping_regions);
  const regionMatches = creatorRegions.filter((region) => shippingRegions.some((shipping) => regionKey(shipping) === regionKey(region)));
  const audienceFit = !creatorRegions.length || !shippingRegions.length ? 8 : regionMatches.length ? 20 : 0;

  const relevantMetric = chooseRelevantMetric(metrics, opportunityText, provider);
  let historicalPerformance = 0;
  if (relevantMetric) {
    historicalPerformance = 5;
    if ((finite(relevantMetric.median_views) ?? 0) >= 1000) historicalPerformance += 3;
    if ((finite(relevantMetric.engagement_rate) ?? 0) >= 0.03) historicalPerformance += 3;
    if ((finite(relevantMetric.click_through_rate) ?? 0) > 0) historicalPerformance += 2;
    if ((finite(relevantMetric.conversion_rate) ?? 0) > 0) historicalPerformance += 2;
  }
  historicalPerformance = clamp(historicalPerformance, 0, 15);

  const commissionRate = finite(opportunity.commission_rate);
  const price = finite(opportunity.price_amount);
  const explicitCommission = finite(opportunity.commission_amount);
  const commissionPerSale = explicitCommission ?? (price !== null && commissionRate !== null ? price * commissionRate / 100 : null);
  let economics = 0;
  if (commissionRate !== null) economics += commissionRate >= 20 ? 9 : commissionRate >= 10 ? 6 : commissionRate > 0 ? 3 : 0;
  if ((commissionPerSale ?? 0) >= 20) economics += 6;
  else if ((commissionPerSale ?? 0) >= 5) economics += 4;
  else if ((commissionPerSale ?? 0) > 0) economics += 2;
  economics = clamp(economics, 0, 15);

  const platforms = list(preferences?.platforms).map(platformKey);
  const providerPlatform = provider === "tiktok_shop" ? "tiktok" : "";
  const platformFit = !platforms.length ? 5 : providerPlatform && platforms.includes(providerPlatform) ? 10 :
    platforms.some((platform) => containsPhrase(opportunityText, platform)) ? 10 : 0;
  const unitsSold = finite(opportunity.product_metrics?.units_sold) ?? 0;
  const confidence = clamp((opportunity.provider_verified ? 3 : 0) + (opportunity.sample_available ? 1 : 0) + (unitsSold > 0 ? 1 : 0), 0, 5);
  const components = {
    content_fit: contentFit, audience_fit: audienceFit, historical_performance: historicalPerformance,
    economics, platform_fit: platformFit, confidence,
  };
  const score = clamp(Object.values(components).reduce((sum, value) => sum + value, 0));
  const reasons = [...base.reasons];
  if (industryMatches.length) reasons.unshift(`Content fit: ${industryMatches.slice(0, 2).join(", ")}`);
  if (regionMatches.length) reasons.push(`Ships to creator region: ${regionMatches[0]}`);
  if (relevantMetric) reasons.push(`Uses ${relevantMetric.category} performance on ${relevantMetric.platform}`);
  if (commissionPerSale !== null) reasons.push(`About ${opportunity.currency ?? "USD"} ${roundMoney(commissionPerSale).toFixed(2)} commission per sale`);

  let easeScore = 100;
  const easeReasons: string[] = [];
  if (opportunity.approval_required) { easeScore -= 20; easeReasons.push("Seller approval required"); }
  else easeReasons.push("Open collaboration");
  if (opportunity.sample_available === false) { easeScore -= 10; easeReasons.push("No sample offered"); }
  else if (opportunity.sample_available === true) easeReasons.push("Sample available");
  if (opportunity.collaboration_model === "targeted") { easeScore -= 15; easeReasons.push("Targeted invitation"); }
  if (creatorRegions.length && shippingRegions.length && !regionMatches.length) { easeScore -= 25; easeReasons.push("Shipping region mismatch"); }
  const minFollowers = finite(opportunity.requirements?.min_followers);
  const requiredPlatform = platformKey(opportunity.requirements?.required_platform);
  const eligibilityMetrics = requiredPlatform
    ? metrics.filter((metric) => platformKey(metric.platform) === requiredPlatform)
    : metrics;
  const knownFollowers = Math.max(0, ...eligibilityMetrics.map((metric) => finite(metric.followers) ?? 0));
  if (minFollowers !== null && knownFollowers < minFollowers) { easeScore -= 30; easeReasons.push(`Requires ${Math.round(minFollowers).toLocaleString()} followers`); }
  if (requiredPlatform && !platforms.includes(requiredPlatform)) {
    easeScore -= 25; easeReasons.push(`Requires ${requiredPlatform}`);
  }
  if (!opportunity.product_url) { easeScore -= 5; easeReasons.push("Application link unavailable"); }
  easeScore = clamp(easeScore);
  const easeLabel = easeScore >= 75 ? "easy" : easeScore >= 50 ? "moderate" : "competitive";

  let estimatedEarningsLow: number | null = null;
  let estimatedEarningsHigh: number | null = null;
  let earningsConfidence: "low" | "medium" | "high" | null = null;
  const views = finite(relevantMetric?.median_views);
  const clickRate = finite(relevantMetric?.click_through_rate);
  const conversionRate = finite(relevantMetric?.conversion_rate);
  const rpm = finite(relevantMetric?.revenue_per_thousand_views);
  if (views !== null && views > 0 && commissionPerSale !== null && clickRate !== null && conversionRate !== null) {
    const expected = views * clickRate * conversionRate * commissionPerSale;
    estimatedEarningsLow = roundMoney(expected * 0.65);
    estimatedEarningsHigh = roundMoney(expected * 1.35);
    earningsConfidence = (finite(relevantMetric?.sample_size) ?? 0) >= 10 ? "high" : "medium";
  } else if (views !== null && views > 0 && rpm !== null) {
    const expected = views / 1000 * rpm;
    estimatedEarningsLow = roundMoney(expected * 0.5);
    estimatedEarningsHigh = roundMoney(expected * 1.5);
    earningsConfidence = "low";
  }

  return {
    score, reasons: Array.from(new Set(reasons)).slice(0, 8), recommendedKit: base.recommendedKit, excluded: false,
    components, easeScore, easeLabel, easeReasons, relevantMetric,
    estimatedEarningsLow, estimatedEarningsHigh, earningsConfidence,
  };
}
