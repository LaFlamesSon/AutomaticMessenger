import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("agent API accepts verified Supabase sessions only", async () => {
  const source = await read("functions/agent-api/index.ts");
  assert.doesNotMatch(source, /x-api-token/i);
  assert.doesNotMatch(source, /\.eq\("api_token"/);
  assert.match(source, /supabase\.auth\.getUser\(jwt\)/);
  assert.match(source, /emailVerified/);
});

test("legacy API-token columns are retired by migration", async () => {
  const migration = await read("migrations/20260830090000_retire_legacy_api_tokens.sql");
  assert.match(migration, /drop column if exists api_token/i);
  assert.match(migration, /drop column if exists api_token_revoked_at/i);
});

test("data export offers paginated personal-data collections without credentials", async () => {
  const source = await read("functions/agent-api/index.ts");
  assert.match(source, /export_version:\s*2/);
  assert.match(source, /export_collections/);
  assert.match(source, /gmail_connections/);
  assert.match(source, /subscription/);
  assert.match(source, /negotiations/);
  const start = source.indexOf("const EXPORT_COLLECTIONS");
  const end = source.indexOf("\n});", start);
  assert.ok(start >= 0 && end > start);
  const allowlist = source.slice(start, end);
  assert.doesNotMatch(allowlist, /refresh_token/);
  assert.doesNotMatch(allowlist, /credential_secret_id/);
});
