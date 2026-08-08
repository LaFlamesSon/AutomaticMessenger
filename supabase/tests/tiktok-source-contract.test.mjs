import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync(new URL("../migrations/20260808220528_tiktok_creator_affiliate_oauth.sql", import.meta.url), "utf8");
const oauth = fs.readFileSync(new URL("../functions/tiktok-oauth/index.ts", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../functions/agent-api/index.ts", import.meta.url), "utf8");
const adapter = fs.readFileSync(new URL("../functions/_shared/tiktok.ts", import.meta.url), "utf8");
const connect = fs.readFileSync(new URL("../../extension/connect.js", import.meta.url), "utf8");

test("TikTok OAuth state and credentials are service-role-only and Vault-backed", () => {
  assert.match(migration, /create table public\.ia_tiktok_oauth_states/);
  assert.match(migration, /state_hash text not null unique/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /vault\.create_secret|vault\.update_secret/);
  assert.match(migration, /vault\.decrypted_secrets/);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/);
  assert.match(migration, /grant execute[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /access_token\s+text|refresh_token\s+text/);
});

test("TikTok callback claims state and validates creator identity and scope", () => {
  assert.match(oauth, /\.update\(\{ used_at: now \}\)/);
  assert.match(oauth, /allowedChromeRedirect/);
  assert.match(oauth, /auth\.tiktok-shops\.com\/api\/v2\/token\/get/);
  assert.match(oauth, /Number\(tokens\.user_type\) !== 1/);
  assert.match(oauth, /TIKTOK_CREATOR_SCOPE/);
  assert.match(oauth, /ia_upsert_tiktok_connection/);
  assert.doesNotMatch(oauth, /console\.(log|error).*token/i);
});

test("agent API owns TikTok connect, refresh, disconnect, and explicit catalog sync", () => {
  for (const action of ["tiktok_connect_start", "tiktok_disconnect", "opportunity_refresh"]) {
    assert.match(api, new RegExp(`case "${action}"`));
  }
  assert.match(api, /ia_get_tiktok_credential/);
  assert.match(api, /syncTikTokCatalog/);
  assert.match(api, /fetchTikTokProducts/);
  assert.match(api, /shop\.tiktok\.com\/alliance\/creator\/auth/);
  assert.match(api, /consent\.searchParams\.set\("app_key", CFG\["ia_tiktok_app_key"\]\)/);
  assert.match(api, /\.eq\("user_id", userId\)/);
  assert.match(adapter, /required_platform: "tiktok"/);
  assert.match(adapter, /allowed_platforms: \["tiktok"\]/);
});

test("durable extension connection page performs TikTok OAuth and immediate refresh", () => {
  assert.match(connect, /searchParams\.get\("flow"\)/);
  assert.match(connect, /"tiktok_connect_start"/);
  assert.match(connect, /caughtup_tiktok/);
  assert.match(connect, /"opportunity_refresh"/);
  assert.doesNotMatch(connect, /access_token.*chrome\.storage[\s\S]*tiktok/i);
});
