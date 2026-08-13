import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sweep = readFileSync(new URL("../functions/agent-sweep/index.ts", import.meta.url), "utf8");
const api = readFileSync(new URL("../functions/agent-api/index.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/20260809210839_creator_negotiation_memory.sql", import.meta.url), "utf8");
const timelineMigration = readFileSync(new URL("../migrations/20260809214727_negotiation_timeline_controls.sql", import.meta.url), "utf8");
const visualHarnessMigration = readFileSync(new URL("../migrations/20260809230135_today_visual_harness_55.sql", import.meta.url), "utf8");

test("negotiations deterministically force Review and persist by Gmail thread", () => {
  assert.match(sweep, /extractCommercialTerms\(subject, emailBody\)/);
  assert.match(sweep, /\.eq\("gmail_account_id", account\.id\)\.eq\("thread_id", msg\.threadId\)/);
  assert.match(sweep, /if \(negotiationRequired && decision === "auto_send"\) decision = "draft"/);
  assert.match(sweep, /human_review_required: negotiationRequired/);
  assert.match(sweep, /proposed_reply: triage\.draft && !draftSafetyViolations\(triage\.draft\)\.length/);
  assert.match(sweep, /dismissed_at: null/);
  assert.match(sweep, /proposed_reply: finalDraft && decision !== "none" && !finalSafety\.length \? finalDraft : null/);
  assert.match(sweep, /commercialTerms\.detected && creatorPreviouslyReplied/);
  assert.match(sweep, /hasEarlierOwnerSent\(msg, thread\.messages \?\? \[\]\)/);
  assert.match(sweep, /const negotiationRequired = !hostileInbound/);
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

test("negotiation draft edits remain manual and update only owned negotiation memory", () => {
  assert.match(api, /case "draft_update"/);
  assert.match(api, /\.eq\("id", row\.negotiation_id\)\.eq\("user_id", user\.id\)/);
  assert.match(api, /proposed_reply: editedBody, media_kit_id: mediaKitId/);
  assert.doesNotMatch(api, /case "draft_update"[\s\S]*?drafts\/send/);
});

test("test negotiations can create one recoverable self-addressed Gmail draft without sending", () => {
  assert.match(api, /case "negotiation_test_draft_create"/);
  assert.match(api, /\.eq\("id", negotiationId\)\.eq\("user_id", user\.id\)\.eq\("is_test", true\)/);
  assert.match(api, /rfc822msgid:\$\{messageId\}/);
  assert.match(api, /buildOpportunityMime\(account\.gmail_address, subject, draftText, kit\.attachment, rfcMessageId\)/);
  assert.match(api, /gmail_message_id: gmailMessageId/);
  assert.match(api, /thread_id: testThreadId/);
  assert.match(api, /auto_sent: false/);
  assert.match(api, /delivery_status: "draft"/);
  assert.match(api, /negotiation_id: negotiation\.id/);
  const action = api.match(/case "negotiation_test_draft_create": \{([\s\S]*?)\n      case "sweep"/)?.[1] ?? "";
  assert.match(action, /users\/me\/drafts"/);
  assert.doesNotMatch(action, /drafts\/send|messages\/send/);
});

test("dismissal is owner scoped and new inbound terms can resurface a negotiation", () => {
  assert.match(api, /case "negotiation_dismiss"/);
  assert.match(api, /\.eq\("id", negotiationId\)\.eq\("user_id", user\.id\)\.is\("dismissed_at", null\)/);
  assert.match(timelineMigration, /alter table ia_negotiations add column if not exists dismissed_at timestamptz/);
  assert.match(timelineMigration, /check \(not is_test or thread_id like 'qa-inbox:%'\)/);
});

test("Today visual harness adds 38 isolated no-send rows to reach 55 visible test cards", () => {
  assert.match(visualHarnessMigration, /where lower\(ga\.gmail_address\) = 'yafet2132@gmail\.com'/);
  assert.match(visualHarnessMigration, /generate_series\(1, 38\)/);
  assert.equal((visualHarnessMigration.match(/"slug":/g) ?? []).length, 38);
  assert.match(visualHarnessMigration, /'qa-inbox:visual-v2:' \|\|/);
  assert.match(visualHarnessMigration, /false, null, false, 'none'/);
  assert.match(visualHarnessMigration, /is_test = true/);
  assert.doesNotMatch(visualHarnessMigration, /drafts\/send|messages\/send|auto_send\s*=\s*true/);
});

test("mixed timeline fixtures are metadata-only and cannot create Gmail drafts or sends", () => {
  assert.match(timelineMigration, /'qa-inbox-message:campaign-brief-v1'/);
  assert.match(timelineMigration, /draft_created = false/);
  assert.match(timelineMigration, /auto_sent = false/);
  assert.match(timelineMigration, /delivery_status = 'none'/);
  assert.match(timelineMigration, /gmail_draft_id = null/);
  assert.doesNotMatch(timelineMigration, /insert into ia_send_attempts/i);
});
