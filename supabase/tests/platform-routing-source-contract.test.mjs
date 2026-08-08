import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const api = fs.readFileSync(new URL("../functions/agent-api/index.ts", import.meta.url), "utf8");
const matcher = fs.readFileSync(new URL("../functions/_shared/affiliate.ts", import.meta.url), "utf8");
const popup = fs.readFileSync(new URL("../../extension/popup.js", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../migrations/20260808045255_creator_platform_routing.sql", import.meta.url), "utf8");

test("provider evidence stays distinct from creator-specific recommendations", () => {
  for (const field of ["allowed_platforms", "required_platform", "recommended_platform", "platform_recommendation_basis", "platform_eligible", "creator_relevant", "channel_evidence"]) {
    assert.match(migration, new RegExp(field));
  }
  assert.match(migration, /'brand_required', 'provider_native', 'creator_performance', 'creator_preference', 'brand_allowed'/);
  assert.match(matcher, /basis: explicitRequired \? "brand_required" : "provider_native"/);
});

test("API validates, persists, and recalculates platform routing on owner-scoped rows", () => {
  assert.match(api, /cleanPlatforms\(body\.allowed_platforms/);
  assert.match(api, /required_platform must be included in allowed_platforms/);
  assert.match(api, /recommended_platform: \(result as any\)\.recommendedPlatform/);
  assert.match(api, /platform_eligible: \(result as any\)\.platformEligible/);
  assert.match(api, /creator_relevant: \(result as any\)\.creatorRelevant/);
  assert.match(api, /\.eq\("id", opportunity\.id\)\.eq\("user_id", userId\)/);
});

test("extension hides ineligible products and labels recommendations separately from requirements", () => {
  assert.match(popup, /opportunity\.platform_eligible !== false/);
  assert.match(popup, /opportunity\.creator_relevant === true/);
  assert.match(popup, /authoritative \? "Required on" : "Recommended for"/);
  assert.match(popup, /platformLabel\(opportunity\.recommended_platform\)/);
});
