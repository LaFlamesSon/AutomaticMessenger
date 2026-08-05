import { assertEquals, assert } from "jsr:@std/assert";
import {
  matchOpportunity, normalizeOpportunityDomain, normalizeOpportunitySourceUrl, senderBusinessDomain,
} from "../functions/_shared/opportunities.ts";

const kits = [
  { id: "fitness", label: "Fitness Kit", description: "fitness activewear gym wellness partnerships", keywords: ["fitness", "activewear"], is_default: false },
  { id: "beauty", label: "Beauty Kit", description: "beauty eyelashes skincare partnerships", keywords: ["beauty", "eyelash"], is_default: false },
  { id: "general", label: "General Kit", description: "general creator overview", is_default: true },
];

Deno.test("opportunity domains and URLs reject unsafe or mismatched sources", () => {
  assertEquals(normalizeOpportunityDomain("https://www.Brand.com/creators"), "brand.com");
  assertEquals(normalizeOpportunityDomain("localhost"), null);
  assertEquals(normalizeOpportunitySourceUrl("http://brand.com/creators", "brand.com"), null);
  assertEquals(normalizeOpportunitySourceUrl("https://evil.example/brand", "brand.com"), null);
  assertEquals(normalizeOpportunitySourceUrl("https://partners.brand.com/creators#apply", "brand.com"), "https://partners.brand.com/creators");
});

Deno.test("only business-domain senders become Gmail relationship signals", () => {
  assertEquals(senderBusinessDomain("Partner <hello@brand.com>"), "brand.com");
  assertEquals(senderBusinessDomain("Person <person@gmail.com>"), null);
  assertEquals(senderBusinessDomain("malformed"), null);
});

Deno.test("fitness and beauty opportunities select their matching kits", () => {
  const preferences = { industries: ["fitness", "beauty"], collaboration_types: ["UGC"] };
  const fitness = matchOpportunity(preferences, kits, {
    brand_name: "PulseFit", brand_domain: "pulsefit.com", description: "Activewear fitness UGC collaboration",
  });
  const beauty = matchOpportunity(preferences, kits, {
    brand_name: "Luma Lash", brand_domain: "lumalash.com", description: "Beauty eyelash creator campaign",
  });
  assertEquals(fitness.recommendedKit?.id, "fitness");
  assertEquals(beauty.recommendedKit?.id, "beauty");
  assert(fitness.score > 40);
  assert(beauty.score > 30);
});

Deno.test("general kit is the fallback and excluded brands cannot match", () => {
  const general = matchOpportunity({ industries: ["travel"] }, kits, {
    brand_name: "Unknown Co", brand_domain: "unknown.co", description: "Unclassified creator partnership",
  });
  assertEquals(general.recommendedKit?.id, "general");
  const excluded = matchOpportunity({ excluded_brands: ["blockedbrand.com"] }, kits, {
    brand_name: "Blocked Brand", brand_domain: "blockedbrand.com", description: "fitness",
  });
  assertEquals(excluded.excluded, true);
  assertEquals(excluded.score, 0);
});

Deno.test("exclusions are exact brand or domain evidence, not loose words", () => {
  const result = matchOpportunity({ excluded_brands: ["Fit Lab"] }, kits, {
    brand_name: "Fitness Laboratory", brand_domain: "fitnesslab.com", description: "fitness partnership",
  });
  assertEquals(result.excluded, false);
});
