import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sweep = readFileSync(new URL("../functions/agent-sweep/index.ts", import.meta.url), "utf8");
const api = readFileSync(new URL("../functions/agent-api/index.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/20260809210839_creator_negotiation_memory.sql", import.meta.url), "utf8");

test("negotiations deterministically force Review and persist by Gmail thread", () => {
  assert.match(sweep, /extractCommercialTerms\(subject, emailBody\)/);
  assert.match(sweep, /\.eq\("gmail_account_id", account\.id\)\.eq\("thread_id", msg\.threadId\)/);
  assert.match(sweep, /if \(negotiationRequired && decision === "auto_send"\) decision = "draft"/);
  assert.match(sweep, /human_review_required: negotiationRequired/);
});

test("negotiation storage is owner scoped and not directly exposed", () => {
  assert.match(migration, /alter table ia_negotiations enable row level security/);
  assert.match(migration, /revoke all on ia_media_kit_rate_profiles, ia_negotiations, ia_negotiation_events from public, anon, authenticated/);
  assert.match(migration, /unique \(gmail_account_id, thread_id\)/);
});

test("extension API returns only authenticated owner's active negotiations", () => {
  assert.match(api, /from\("ia_negotiations"\)/);
  assert.match(api, /\.eq\("user_id", user\.id\)\.eq\("human_review_required", true\)/);
  assert.match(api, /media_kit_rate_update/);
});
