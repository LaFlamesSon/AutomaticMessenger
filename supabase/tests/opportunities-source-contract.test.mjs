import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const api = fs.readFileSync(new URL("../functions/agent-api/index.ts", import.meta.url), "utf8");
const sweep = fs.readFileSync(new URL("../functions/agent-sweep/index.ts", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../migrations/20260805011421_opportunities_v1.sql", import.meta.url), "utf8");

test("opportunity tables are RLS-protected and service-role only", () => {
  for (const table of ["ia_opportunity_preferences", "ia_brand_relationships", "ia_opportunities", "ia_opportunity_events", "ia_opportunity_send_attempts"]) {
    assert.match(migration, new RegExp(`alter table ${table} enable row level security`));
  }
  assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant all[\s\S]*to service_role/);
});

test("API exposes complete opt-in, matching, draft, preview, and explicit send contract", () => {
  for (const action of ["opportunities_get", "opportunity_preferences_set", "brand_relationship_set", "opportunity_create", "opportunity_refresh", "opportunity_update", "opportunity_prepare_draft", "opportunity_draft_get", "opportunity_send"]) {
    assert.match(api, new RegExp(`case "${action}"`));
  }
  assert.match(api, /auto_sent: false/);
  assert.match(api, /preview_version/);
  assert.match(api, /ia_opportunity_send_attempts/);
});

test("routine sweeps add confirmation-required business relationship suggestions only when opted in", () => {
  assert.match(sweep, /ia_opportunity_preferences/);
  assert.match(sweep, /senderBusinessDomain/);
  assert.match(sweep, /relationship_status: "suggested"/);
  assert.match(sweep, /confirmed: false/);
  assert.doesNotMatch(sweep, /opportunity_prepare_draft/);
});
