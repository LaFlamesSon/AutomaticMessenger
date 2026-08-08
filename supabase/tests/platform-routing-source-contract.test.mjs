import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const api = fs.readFileSync(new URL("../functions/agent-api/index.ts", import.meta.url), "utf8");
const matcher = fs.readFileSync(new URL("../functions/_shared/affiliate.ts", import.meta.url), "utf8");
const popup = fs.readFileSync(new URL("../../extension/popup.js", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../migrations/20260808045255_creator_platform_routing.sql", import.meta.url), "utf8");
const orderingFix = fs.readFileSync(new URL("../migrations/20260808052904_fix_affiliate_daily_surface_order.sql", import.meta.url), "utf8");

test("posting platforms come only from listing or provider evidence", () => {
  for (const field of ["allowed_platforms", "required_platform", "platform_eligible", "creator_relevant", "channel_evidence"]) {
    assert.match(migration, new RegExp(field));
  }
  assert.doesNotMatch(migration, /recommended_platform|creator_performance|creator_preference/);
  assert.match(matcher, /listingPlatformEvidence/);
  assert.doesNotMatch(matcher, /recommendedPlatform|platformBasis|metricPlatformScore/);
});

test("API validates listing platforms and recalculates only owner-scoped relevance", () => {
  assert.match(api, /cleanPlatforms\(body\.allowed_platforms/);
  assert.match(api, /required_platform must be included in allowed_platforms/);
  assert.match(api, /platform_eligible: \(result as any\)\.platformEligible/);
  assert.match(api, /creator_relevant: \(result as any\)\.creatorRelevant/);
  assert.match(api, /\.eq\("id", opportunity\.id\)\.eq\("user_id", userId\)/);
  assert.doesNotMatch(api, /recommended_platform/);
});

test("database atomically surfaces at most ten new products per creator per local day", () => {
  assert.match(migration, /ia_surface_daily_affiliate_opportunities/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /p_daily_limit > 10/);
  assert.match(migration, /opportunity_kind = 'affiliate_product'\s+and surfaced_on = p_surface_date/);
  assert.match(migration, /for update skip locked/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /revoke all on function .* from public, anon, authenticated/);
  assert.match(api, /p_user_id: userId, p_surface_date: localDateKey\(voiceProfile\?\.timezone\), p_daily_limit: 10/);
  assert.match(orderingFix, /order by match_score desc, created_at desc, id/);
  assert.doesNotMatch(orderingFix, /observed_at/);
});

test("extension shows listing-backed platforms only and caps the daily feed at ten", () => {
  assert.match(popup, /opportunity\.platform_eligible !== false/);
  assert.match(popup, /opportunity\.creator_relevant === true/);
  assert.match(popup, /opportunity\.required_platform \? \[opportunity\.required_platform\]/);
  assert.match(popup, /\.slice\(0, 10\)/);
  assert.doesNotMatch(popup, /Recommended for/);
});
