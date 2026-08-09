import { assertEquals } from "jsr:@std/assert";
import {
  evaluateCommercialTerms, extractCommercialTerms, negotiationEventType, negotiationStage,
} from "../functions/_shared/negotiations.ts";

Deno.test("commercial extraction finds a flat offer and deliverables", () => {
  const terms = extractCommercialTerms("Paid partnership", "Our offer is $750 USD for 2 videos and 3 stories.");
  assertEquals(terms.detected, true);
  assertEquals(terms.flat_fee_amount, 750);
  assertEquals(terms.currency, "USD");
  assertEquals(terms.deliverables, ["2 videos", "3 stories"]);
});

Deno.test("commercial extraction finds commission and rights", () => {
  const terms = extractCommercialTerms("Affiliate terms", "We can offer 12.5% commission with 90-day usage rights and exclusivity.");
  assertEquals(terms.commission_rate, 12.5);
  assertEquals(terms.usage_rights, true);
  assertEquals(terms.exclusivity, true);
});

Deno.test("counteroffer wording advances the deal", () => {
  const terms = extractCommercialTerms("Re: campaign", "Our revised offer is $900 instead.");
  assertEquals(terms.counteroffer, true);
  assertEquals(negotiationStage(true, terms), "countered");
  assertEquals(negotiationEventType(true, terms), "counteroffer");
});

Deno.test("ordinary collaboration inquiry is not a negotiation", () => {
  const terms = extractCommercialTerms("Creator partnership", "Would you be interested in learning about our skincare launch?");
  assertEquals(terms.detected, false);
});

Deno.test("threshold evaluation is fail-closed and evidence bounded", () => {
  const profile = { flat_fee_floor: 500, flat_fee_target: 900, commission_floor: 15, commission_target: 25 };
  assertEquals(evaluateCommercialTerms(extractCommercialTerms("Offer", "We offer $300."), profile), "below_minimum");
  assertEquals(evaluateCommercialTerms(extractCommercialTerms("Offer", "We offer $700."), profile), "within_range");
  assertEquals(evaluateCommercialTerms(extractCommercialTerms("Offer", "We offer $1000."), profile), "at_or_above_target");
  assertEquals(evaluateCommercialTerms(extractCommercialTerms("Terms", "We require perpetual usage rights."), profile), "insufficient_evidence");
  assertEquals(evaluateCommercialTerms(extractCommercialTerms("Offer", "We offer $1000."), null), "unconfigured");
});

Deno.test("hybrid guarantee and commission floors both apply", () => {
  const profile = { hybrid_guarantee_floor: 400, commission_floor: 15, commission_target: 20 };
  assertEquals(evaluateCommercialTerms(extractCommercialTerms("Hybrid", "$250 plus 20% commission"), profile), "below_minimum");
  assertEquals(evaluateCommercialTerms(extractCommercialTerms("Hybrid", "$500 plus 18% commission"), profile), "within_range");
});
