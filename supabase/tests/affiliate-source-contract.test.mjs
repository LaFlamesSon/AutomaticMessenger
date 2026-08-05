import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const api = fs.readFileSync(new URL("../functions/agent-api/index.ts", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../migrations/20260805025333_affiliate_opportunity_api.sql", import.meta.url), "utf8");

test("affiliate tables are RLS-protected and service-role only", () => {
  for (const table of ["ia_creator_category_metrics", "ia_affiliate_connections"]) {
    assert.match(migration, new RegExp(`alter table ${table} enable row level security`));
  }
  assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant all[\s\S]*to service_role/);
  assert.match(migration, /credential_secret_id uuid/);
  assert.doesNotMatch(migration, /access_token|refresh_token|client_secret/);
});
test("affiliate API exposes private metrics, sources, preview, and product creation", () => {
  for (const action of ["affiliate_sources_get", "affiliate_metrics_get", "affiliate_metric_upsert", "affiliate_metric_delete", "affiliate_opportunity_preview", "affiliate_opportunity_create"]) {
    assert.match(api, new RegExp(`case "${action}"`));
  }
  assert.match(api, /matchAffiliateOpportunity/);
  assert.match(api, /\.eq\("user_id", user\.id\)/);
  assert.match(api, /provider_verified: false/);
  assert.doesNotMatch(api, /auto_sent: true[\s\S]*affiliate/);
});
