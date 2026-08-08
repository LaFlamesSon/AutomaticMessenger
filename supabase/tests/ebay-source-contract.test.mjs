import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const api = fs.readFileSync(new URL("../functions/agent-api/index.ts", import.meta.url), "utf8");
const adapter = fs.readFileSync(new URL("../functions/_shared/ebay.ts", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../migrations/20260808035328_ebay_affiliate_connector.sql", import.meta.url), "utf8");

test("eBay connection uses app-shared credentials without storing provider secrets", () => {
  assert.match(migration, /credential_mode text not null/);
  assert.match(migration, /credential_mode = 'app_shared'/);
  assert.match(migration, /external_account_ref ~ '\^\[0-9\]\{10\}\$'/);
  assert.doesNotMatch(migration, /client_secret|access_token|refresh_token/);
  assert.match(api, /config\["ia_ebay_client_id"\]/);
  assert.match(api, /config\["ia_ebay_client_secret"\]/);
  assert.doesNotMatch(api, /clientSecret:\s*body/);
});

test("eBay sync is owner-scoped, explicit-refresh driven, and preserves product status", () => {
  for (const action of ["affiliate_ebay_connection_set", "affiliate_ebay_disconnect", "opportunity_refresh"]) {
    assert.match(api, new RegExp(`case "${action}"`));
  }
  assert.match(api, /\.eq\("user_id", userId\)/);
  assert.match(api, /status: existingByRef\.get\(sourceRef\)\?\.status \?\? "new"/);
  assert.match(api, /commission_rate: null, commission_amount: null/);
  assert.match(adapter, /itemAffiliateWebUrl/);
  assert.match(adapter, /provider_verified: true/);
  assert.doesNotMatch(adapter, /commission/);
});
