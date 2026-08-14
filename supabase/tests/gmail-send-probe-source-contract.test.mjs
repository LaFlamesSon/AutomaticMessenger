import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("production Gmail OAuth requests only identity and gmail.send", async () => {
  const api = await read("functions/agent-api/index.ts");
  const oauth = await read("functions/gmail-oauth/index.ts");
  const connectBlock = api.match(/case "gmail_connect_start":[\s\S]*?case "calendar_get":/)?.[0] ?? "";
  assert.match(connectBlock, /ia_google_send_client_id/);
  assert.match(connectBlock, /ia_google_send_client_secret/);
  assert.match(connectBlock, /openid email profile https:\/\/www\.googleapis\.com\/auth\/gmail\.send/);
  assert.match(connectBlock, /include_granted_scopes", "false"/);
  assert.match(connectBlock, /login_hint", user\.email/);
  assert.doesNotMatch(connectBlock, /gmail\.(?:modify|readonly|compose|settings)/);
  assert.match(oauth, /openidconnect\.googleapis\.com\/v1\/userinfo/);
  assert.match(oauth, /email_verified/);
  assert.match(oauth, /oauth_capability: "send_only"/);
});

test("legacy OAuth and probe configuration are removed by migration", async () => {
  const migration = await read("migrations/20260814024512_gmail_send_only_oauth.sql");
  assert.match(migration, /oauth_capability = 'legacy_disabled'/);
  assert.match(migration, /'send_only'/);
  assert.match(migration, /'inbox_read'/);
  assert.match(migration, /'ia_google_client_id', 'ia_google_client_secret'/);
  assert.match(migration, /ia_google_send_probe_client_id/);
  assert.match(migration, /ia_google_send_client_id/);
  assert.match(migration, /ia_google_send_probe_email/);
});

test("completed acceptance probe remains retired without reading configuration", async () => {
  const probe = await read("functions/gmail-send-probe/index.ts");
  assert.match(probe, /status: 410/);
  assert.match(probe, /probe_retired/);
  assert.doesNotMatch(probe, /ia_get_config|ia_google|oauth2\.googleapis\.com|gmail\.googleapis\.com/);
});
