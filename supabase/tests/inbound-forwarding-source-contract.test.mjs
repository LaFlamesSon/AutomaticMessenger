import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const ingest = read("../functions/inbound-email/index.ts");
const api = read("../functions/agent-api/index.ts");
const aliasHelper = read("../functions/_shared/inbound-alias.ts");
const sending = read("../functions/_shared/cloudflare-email-sending.ts");
const migration = read("../migrations/20260814032552_inbound_forwarding_pipeline.sql");
const stableMigration = read("../migrations/20260815200000_stable_forwarding_aliases.sql");
const hardening = read("../migrations/20260814041500_inbound_forwarding_post_deploy_hardening.sql");
const acceptanceTest = read("../migrations/20260814042820_forwarding_acceptance_test.sql");
const acceptanceThread = read("../migrations/20260814043733_allow_forwarding_acceptance_test_threads.sql");
const autoSendAcceptance = read("../migrations/20260814045411_forwarding_auto_send_acceptance.sql");
const worker = read("../../workers/inbound-email/src/index.ts");
const recipient = read("../../workers/inbound-email/src/recipient.ts");

test("stable aliases use the Gmail local part on getcaughtup.io without plus-addressing", () => {
  assert.match(aliasHelper, /STABLE_INBOUND_HOST = "getcaughtup\.io"/);
  assert.match(aliasHelper, /proposedAliasSlug/);
  assert.match(aliasHelper, /gmail\.com|googlemail\.com/);
  assert.match(api, /stableAliasAddress\(slug\)/);
  assert.match(api, /allocateAliasSlug/);
  assert.doesNotMatch(api, /inbox\+\$\{token\}@inbound\.getcaughtup\.io/);
  assert.match(ingest, /parseInboundRecipient\(envelopeTo\)/);
  assert.match(recipient, /STABLE_ALIAS_RE/);
  assert.match(recipient, /RESERVED_ALIAS_SLUGS/);
});

test("catch-all Email Routing owns stable aliases; opaque inbound mailboxes stay dual-format", () => {
  const routing = read("../functions/_shared/cloudflare-email-routing.ts");
  assert.match(routing, /ia_cloudflare_api_token/);
  assert.match(routing, /email\/routing\/rules/);
  assert.match(routing, /diagnoseCloudflareCatchAll/);
  assert.match(routing, /item\.type === "all"/);
  assert.match(routing, /caughtup-inbound-email/);
  assert.match(routing, /ensureCloudflareInboundMailbox/);
  assert.match(api, /isOpaqueOrLegacyInboundAlias/);
  assert.doesNotMatch(api, /ensureCloudflareInboundMailbox\(CFG, created\.alias_address, existing\?\.alias_address\)/);
  assert.doesNotMatch(routing, /console\.(?:log|error|info|debug)/);
});

test("Cloudflare buffers MIME once, minimizes it, and signs the exact JSON body", () => {
  assert.equal((worker.match(/message\.raw/g) ?? []).length, 4, "raw should appear only in size/stream handling and payload metadata");
  assert.match(worker, /new Response\(message\.raw\)\.arrayBuffer\(\)/);
  assert.match(worker, /PostalMime\.parse\(raw/);
  assert.match(worker, /text: text\.replace\([\s\S]+slice\(0, MAX_BODY_CHARS\)/);
  const payload = worker.match(/return \{\n    alias_token:[\s\S]*?\n  \};/)?.[0] ?? "";
  assert.doesNotMatch(payload, /\n\s+html:/);
  assert.match(worker, /crypto\.subtle\.sign\(\{ name: "ECDSA", hash: "SHA-256" \}/);
  assert.match(worker, /`\$\{timestamp\}\.\$\{body\}`/);
  assert.match(worker, /await fetch\(env\.SUPABASE_INGEST_URL/);
  assert.match(worker, /parseInboundRecipient/);
});

test("ingest rejects unsigned or stale calls before resolving an alias", () => {
  assert.match(ingest, /Math\.abs\(Date\.now\(\) \/ 1000 - seconds\) > 300/);
  assert.match(ingest, /crypto\.subtle\.verify\(\{ name: "ECDSA", hash: "SHA-256" \}/);
  const serve = ingest.slice(ingest.indexOf("Deno.serve"));
  assert.ok(serve.indexOf("validSignature(req, rawBody)") < serve.indexOf('from("ia_forwarding_aliases")'));
  assert.match(ingest, /lookupForwardingAlias/);
  assert.match(ingest, /eq\("alias_address", recipient\.address\)/);
  assert.match(ingest, /eq\("legacy_alias_address", recipient\.address\)/);
  assert.doesNotMatch(ingest, /console\.(?:log|error)\([^\n]*(?:payload\.text|rawBody|alias_token)/);
});

test("forwarding verification trusts only Google's sender and allowlisted confirmation host", () => {
  assert.match(ingest, /GOOGLE_FORWARDING_SENDER = "forwarding-noreply@google\.com"/);
  assert.match(ingest, /payload\.envelope_from !== GOOGLE_FORWARDING_SENDER \|\| parseStrictRecipient\(payload\.from\) !== GOOGLE_FORWARDING_SENDER/);
  assert.match(ingest, /parsed\.hostname !== "mail-settings\.google\.com"/);
  assert.match(ingest, /pathname\.replace\(\/%5B\/gi, "\["\)/);
  assert.match(ingest, /path\.startsWith\("\/mail\/vf-"\)/);
  assert.doesNotMatch(ingest, /parsed\.toString\(\)/);
  assert.match(ingest, /status: "google_verification_received"/);
  assert.match(api, /case "forwarding_setup_activate"/);
  assert.match(api, /status: "awaiting_gmail_enable"/);
  assert.doesNotMatch(api, /\.in\("status", \["verification_received", "active"\]\)/);
});

test("forwarded content is deduplicated, bounded, and erased after processing", () => {
  assert.match(migration, /unique \(forwarding_alias_id, dedupe_key\)/);
  assert.match(migration, /check \(length\(text_body\) <= 100000\)/);
  assert.match(ingest, /MAX_DAILY_MESSAGES = 200/);
  assert.match(ingest, /\.gte\("created_at", dayStart\.toISOString\(\)\)/);
  assert.match(ingest, /staleProcessing/);
  assert.match(ingest, /text_body: ""/);
  assert.match(ingest, /processing_status: "processed"/);
});

test("forwarded drafts preserve safety, Review negotiations, and explicit send claims", () => {
  assert.match(ingest, /hostileInboundDetected\(payload\.subject, payload\.text\)/);
  assert.match(ingest, /draftSafetyViolations\(finalDraft\)/);
  assert.match(ingest, /if \(negotiationRequired && decision === "auto_send"\) decision = "draft"/);
  assert.match(api, /case "forwarded_draft_get"/);
  assert.match(api, /case "forwarded_draft_update"/);
  assert.match(api, /case "forwarded_send"/);
  const send = api.match(/case "forwarded_send": \{([\s\S]*?)\n      case "gmail_connect_start"/)?.[1] ?? "";
  assert.ok(send.indexOf("preview_version") < send.indexOf('from("ia_send_attempts").insert'));
  assert.ok(send.indexOf('status: "sending"') < send.indexOf('users/me/messages/send'));
  assert.match(send, /draftSafetyViolations\(replyBody\)/);
  assert.match(send, /InReplyTo: row\.rfc_message_id|inReplyTo: row\.rfc_message_id/);
  assert.match(send, /messageId: row\.outbound_message_id/);
});

test("forwarded negotiations require a creator reply and remain linked across replies", () => {
  assert.match(ingest, /sanitizeMessageIds\(`\$\{payload\.references\} \$\{payload\.in_reply_to\}`\)/);
  assert.match(ingest, /\.eq\("gmail_account_id", accountId\)\.in\("outbound_message_id", refs\)/);
  assert.match(ingest, /\.eq\("gmail_account_id", account\.id\)\.eq\("thread_id", threadKey\)\.eq\("delivery_status", "sent"\)/);
  assert.match(ingest, /commercialTerms\.detected && Boolean\(previousReplies\?\.length\)/);
  assert.match(ingest, /\|\| Boolean\(activeNegotiation\)/);
  assert.match(ingest, /human_review_required: negotiationRequired \|\| \(isForwardingTest && !forwardingTestAutoSend\)/);

  const send = api.match(/case "forwarded_send": \{([\s\S]*?)\n      case "gmail_connect_start"/)?.[1] ?? "";
  assert.match(send, /sent_via: "manual_extension"/);
  assert.match(send, /inReplyTo: row\.rfc_message_id/);
  assert.match(send, /references: row\.rfc_references/);
  assert.match(send, /messageId: row\.outbound_message_id/);

  assert.match(api, /row\.ingestion_source === "forwarded" && row\.negotiation_id/);
  assert.match(api, /draft_email: linkedNegotiationDrafts\.get\(row\.id\) \?\? null/);
});

test("forwarding acceptance tests are self-addressed, one-use, and impossible to reply to", () => {
  assert.match(api, /case "forwarding_test_send"/);
  const action = api.match(/case "forwarding_test_send": \{([\s\S]*?)\n      case "forwarding_setup_disable"/)?.[1] ?? "";
  assert.match(action, /body\.confirm !== true/);
  assert.match(action, /\.eq\("status", "route_verified"\)/);
  assert.match(action, /profile\?\.auto_send === true && profile\?\.reply_mode === "auto_send"/);
  assert.match(action, /deliveryTarget === "inbound_alias" \? alias\.alias_address : account\.gmail_address/);
  assert.match(action, /`test\+\$\{testToken\}@inbound\.getcaughtup\.io`/);
  assert.match(action, /users\/me\/messages\/send/);
  assert.doesNotMatch(action, /To:\s*[^$\n]*@(?:example|gmail|outlook|yahoo)\./i);

  assert.match(acceptanceTest, /create table public\.ia_forwarding_test_runs/);
  assert.match(acceptanceTest, /token_hash text not null unique/);
  assert.match(acceptanceTest, /alter table public\.ia_forwarding_test_runs enable row level security/);
  assert.match(acceptanceTest, /revoke all on table public\.ia_forwarding_test_runs from public, anon, authenticated/);
  assert.match(ingest, /\^test\\\+\(\[0-9a-f\]\{48\}\)@inbound\\\.getcaughtup\\\.io\$/);
  assert.match(ingest, /from\("ia_forwarding_test_runs"\)/);
  assert.match(ingest, /if \(isForwardingTest && !forwardingTestAutoSend && decision === "auto_send"\) decision = "draft"/);
  assert.match(ingest, /if \(\(!isForwardingTest \|\| forwardingTestAutoSend\) && decision === "auto_send"/);
  assert.match(ingest, /is_test: isForwardingTest/);
  assert.match(ingest, /`fwd-test:\$\{forwardingTestRunId\}`/);
  assert.match(acceptanceThread, /not is_test or thread_id like 'qa-inbox:%' or thread_id like 'fwd-test:%'/);
  assert.match(api, /if \(row\.is_test\) return json\(\{ error: "test drafts can never be sent", code: "test_send_blocked" \}/);
});

test("Auto-send acceptance is enabled only for an active policy and self-addressed reply", () => {
  assert.match(autoSendAcceptance, /add column allow_auto_send boolean not null default false/);
  const action = api.match(/case "forwarding_test_send": \{([\s\S]*?)\n      case "forwarding_setup_disable"/)?.[1] ?? "";
  assert.match(action, /const autoSendTest = body\.mode === "auto_send"/);
  assert.match(action, /profile\?\.auto_send === true && profile\?\.reply_mode === "auto_send"/);
  assert.match(action, /if \(autoSendTest\) recentTestQuery = recentTestQuery\.eq\("allow_auto_send", true\)/);
  assert.match(action, /autoSendTest \? 1 : 3/);
  assert.match(action, /allow_auto_send: autoSendTest/);
  assert.match(ingest, /forwardingTestAutoSend \? String\(account\.gmail_address\)\.toLowerCase\(\)/);
  assert.match(ingest, /buildReplyMime\(\{ to: replyRecipient/);
  assert.doesNotMatch(ingest, /buildReplyMime\(\{ to: sender\.address/);
  assert.match(ingest, /human_review_required: negotiationRequired \|\| \(isForwardingTest && !forwardingTestAutoSend\)/);
});

test("new forwarding tables are service-role-only under RLS", () => {
  for (const table of ["ia_forwarding_aliases", "ia_inbound_messages"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`));
    assert.match(migration, new RegExp(`grant all on table public\\.${table} to service_role`));
  }
  assert.match(acceptanceTest, /grant all on table public\.ia_forwarding_test_runs to service_role/);
  assert.match(migration, /ingestion_source in \('gmail_api', 'forwarded'\)/);
  assert.match(hardening, /ia_inbound_messages\(user_id, created_at desc\)/);
  assert.match(hardening, /ia_inbound_messages\(processed_email_id\)/);
  assert.match(hardening, /revoke execute on function public\.rls_auto_enable\(\) from public, anon, authenticated/);
});

test("route verification requires an external probe through Gmail, not a user click", () => {
  assert.match(stableMigration, /status in \(\s*'address_ready'/);
  assert.match(stableMigration, /alias_slug/);
  assert.match(stableMigration, /legacy_alias_address/);
  assert.match(stableMigration, /kind in \('controlled_test', 'route_probe'\)/);
  assert.match(api, /case "forwarding_route_probe"/);
  assert.match(api, /startExternalRouteProbe/);
  assert.match(api, /sendExternalRouteProbe/);
  assert.match(api, /kind: "route_probe"/);
  assert.match(sending, /setup-probe@getcaughtup\.io/);
  assert.match(sending, /email\/sending\/send/);
  assert.match(ingest, /ROUTE_PROBE_SENDER/);
  assert.match(ingest, /claimRouteProbe/);
  assert.match(ingest, /status: "route_verified"/);
  assert.match(api, /inbound_forwarding_ready: routeVerifiedStatus/);
  assert.doesNotMatch(api, /status: "active", activated_at: now/);
  assert.match(ingest, /routeVerifiedStatus\(alias\.status\)/);
});
