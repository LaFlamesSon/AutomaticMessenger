import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const inbound = readFileSync(new URL("../functions/inbound-email/index.ts", import.meta.url), "utf8");
const sweep = readFileSync(new URL("../functions/agent-sweep/index.ts", import.meta.url), "utf8");
const api = readFileSync(new URL("../functions/agent-api/index.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/20260809210839_creator_negotiation_memory.sql", import.meta.url), "utf8");
const timelineMigration = readFileSync(new URL("../migrations/20260809214727_negotiation_timeline_controls.sql", import.meta.url), "utf8");
const visualHarnessMigration = readFileSync(new URL("../migrations/20260809230135_today_visual_harness_55.sql", import.meta.url), "utf8");

test("forwarded negotiations deterministically force Review and persist by thread", () => {
  assert.match(inbound, /extractCommercialTerms\(payload\.subject, payload\.text\)/);
  assert.match(inbound, /\.eq\("gmail_account_id", account\.id\)\.eq\("thread_id", threadKey\)/);
  assert.match(inbound, /if \(negotiationRequired && decision === "auto_send"\) decision = "draft"/);
  assert.match(inbound, /human_review_required: true/);
  assert.match(inbound, /proposed_reply: triage\.draft/);
  assert.match(inbound, /dismissed_at: null/);
  assert.match(inbound, /commercialTerms\.detected && Boolean\(previousReplies\?\.length\)/);
  assert.match(inbound, /ingestion_source: "forwarded"/);
});

test("retired inbox sweep cannot read Gmail or mutate state", () => {
  assert.match(sweep, /status: 410/);
  assert.match(sweep, /inbox_sweep_retired/);
  assert.doesNotMatch(sweep, /gmail\.googleapis\.com|createClient|ia_processed_emails|ia_negotiations/);
});

test("forwarding test drafts cannot be manually sent", () => {
  assert.match(api, /if \(row\.is_test\) return json\(\{ error: "test drafts can never be sent", code: "test_send_blocked" \}/);
  assert.doesNotMatch(api, /qa_stage_negotiation|negotiation_test_draft_create|internalDateSource=dateHeader/);
});

test("negotiation storage is owner scoped and not directly exposed", () => {
  assert.match(migration, /alter table ia_negotiations enable row level security/);
  assert.match(migration, /revoke all on ia_media_kit_rate_profiles, ia_negotiations, ia_negotiation_events from public, anon, authenticated/);
  assert.match(migration, /unique \(gmail_account_id, thread_id\)/);
});

test("extension API returns only authenticated owner's active negotiations", () => {
  assert.match(api, /from\("ia_negotiations"\)/);
  assert.match(api, /\.eq\("user_id", user\.id\)\.eq\("human_review_required", true\)/);
  assert.match(api, /\.is\("dismissed_at", null\)/);
  assert.match(api, /media_kit_rate_update/);
  assert.match(api, /draft_email: linkedNegotiationDrafts\.get\(row\.id\) \?\? null/);
});

test("forwarded draft edits remain manual and update only owned negotiation memory", () => {
  assert.match(api, /case "forwarded_draft_update"/);
  assert.match(api, /\.eq\("id", row\.negotiation_id\)\.eq\("user_id", user\.id\)/);
  assert.match(api, /proposed_reply: editedBody, media_kit_id: mediaKitId/);
  const action = api.match(/case "forwarded_draft_update": \{([\s\S]*?)\n      case "forwarded_send"/)?.[1] ?? "";
  assert.doesNotMatch(action, /messages\/send|drafts\/send/);
});

test("legacy synthetic Gmail negotiation drafts are retired", () => {
  assert.doesNotMatch(api, /case "negotiation_test_draft_create"/);
  assert.doesNotMatch(api, /users\/me\/drafts|drafts\/send/);
  assert.doesNotMatch(api, /gmail_draft_id/);
});

test("dismissal is owner scoped and new inbound terms can resurface a negotiation", () => {
  assert.match(api, /case "negotiation_dismiss"/);
  assert.match(api, /\.eq\("id", negotiationId\)\.eq\("user_id", user\.id\)\.is\("dismissed_at", null\)/);
  assert.match(timelineMigration, /alter table ia_negotiations add column if not exists dismissed_at timestamptz/);
  assert.match(timelineMigration, /check \(not is_test or thread_id like 'qa-inbox:%'\)/);
});

test("Today visual harness remains metadata-only and non-sendable", () => {
  assert.match(visualHarnessMigration, /where lower\(ga\.gmail_address\) = 'yafet2132@gmail\.com'/);
  assert.match(visualHarnessMigration, /generate_series\(1, 38\)/);
  assert.equal((visualHarnessMigration.match(/"slug":/g) ?? []).length, 38);
  assert.match(visualHarnessMigration, /false, null, false, 'none'/);
  assert.match(visualHarnessMigration, /is_test = true/);
  assert.doesNotMatch(visualHarnessMigration, /drafts\/send|messages\/send|auto_send\s*=\s*true/);
});

test("mixed timeline fixtures cannot create provider drafts or sends", () => {
  assert.match(timelineMigration, /'qa-inbox-message:campaign-brief-v1'/);
  assert.match(timelineMigration, /draft_created = false/);
  assert.match(timelineMigration, /auto_sent = false/);
  assert.match(timelineMigration, /delivery_status = 'none'/);
  assert.match(timelineMigration, /gmail_draft_id = null/);
  assert.doesNotMatch(timelineMigration, /insert into ia_send_attempts/i);
});
