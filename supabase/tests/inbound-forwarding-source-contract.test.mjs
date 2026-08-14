import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const ingest = read("../functions/inbound-email/index.ts");
const api = read("../functions/agent-api/index.ts");
const migration = read("../migrations/20260814032552_inbound_forwarding_pipeline.sql");
const worker = read("../../workers/inbound-email/src/index.ts");

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
});

test("ingest rejects unsigned or stale calls before resolving an alias", () => {
  assert.match(ingest, /Math\.abs\(Date\.now\(\) \/ 1000 - seconds\) > 300/);
  assert.match(ingest, /crypto\.subtle\.verify\(\{ name: "ECDSA", hash: "SHA-256" \}/);
  assert.ok(ingest.indexOf("validSignature(req, rawBody)") < ingest.indexOf('from("ia_forwarding_aliases")'));
  assert.match(ingest, /alias_token_hash", tokenHash/);
  assert.doesNotMatch(ingest, /console\.(?:log|error)\([^\n]*(?:payload\.text|rawBody|alias_token)/);
});

test("forwarding verification trusts only Google's sender and allowlisted confirmation host", () => {
  assert.match(ingest, /GOOGLE_FORWARDING_SENDER = "forwarding-noreply@google\.com"/);
  assert.match(ingest, /payload\.envelope_from !== GOOGLE_FORWARDING_SENDER \|\| parseStrictRecipient\(payload\.from\) !== GOOGLE_FORWARDING_SENDER/);
  assert.match(ingest, /parsed\.hostname === "mail-settings\.google\.com"/);
  assert.match(ingest, /status: "verification_received"/);
  assert.match(api, /case "forwarding_setup_activate"/);
  assert.match(api, /\.in\("status", \["verification_received", "active"\]\)/);
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
  const send = api.match(/case "forwarded_send": \{([\s\S]*?)\n      case "send_draft"/)?.[1] ?? "";
  assert.ok(send.indexOf("preview_version") < send.indexOf('from("ia_send_attempts").insert'));
  assert.ok(send.indexOf('status: "sending"') < send.indexOf('users/me/messages/send'));
  assert.match(send, /draftSafetyViolations\(replyBody\)/);
  assert.match(send, /InReplyTo: row\.rfc_message_id|inReplyTo: row\.rfc_message_id/);
  assert.match(send, /messageId: row\.outbound_message_id/);
});

test("new forwarding tables are service-role-only under RLS", () => {
  for (const table of ["ia_forwarding_aliases", "ia_inbound_messages"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`));
    assert.match(migration, new RegExp(`grant all on table public\\.${table} to service_role`));
  }
  assert.match(migration, /ingestion_source in \('gmail_api', 'forwarded'\)/);
});
