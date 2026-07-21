import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("user-facing processed-email and run reads carry owned account scope", async () => {
  const api = await read("functions/agent-api/index.ts");
  assert.match(api, /ownedAccountIds\(supabase, user\.id\)/);
  assert.ok((api.match(/\.in\("gmail_account_id", accountIds\)/g) ?? []).length >= 4);
  assert.match(api, /\.eq\("user_id", user\.id\)/);
});

test("verified Supabase identity bootstraps an owned user and default profile", async () => {
  const api = await read("functions/agent-api/index.ts");
  assert.match(api, /email_confirmed_at \|\| authUser\.confirmed_at/);
  assert.match(api, /insert\(\{ email: normalizedEmail, auth_user_id: authUser\.id \}\)/);
  assert.match(api, /upsert\(\{ user_id: user\.id \}, \{ onConflict: "user_id", ignoreDuplicates: true \}\)/);
  assert.doesNotMatch(api, /body\.user_id/);
});

test("manual sweep passes trusted authenticated ownership to the worker", async () => {
  const api = await read("functions/agent-api/index.ts");
  const sweep = await read("functions/agent-sweep/index.ts");
  assert.match(api, /trigger: "manual", user_id: user\.id/);
  assert.match(sweep, /accountQuery = accountQuery\.eq\("user_id", requestedUserId\)/);
  assert.match(sweep, /manual sweep requires a valid user_id/);
});

test("targeted manual sweeps isolate one owned Gmail message", async () => {
  const sweep = await read("functions/agent-sweep/index.ts");
  assert.match(sweep, /targeted manual sweep requires valid Gmail account and message IDs/);
  assert.match(sweep, /accountQuery = accountQuery\.eq\("id", requestedAccountId\)/);
  assert.match(sweep, /messageRefs = \[\{ id: requestedMessageId \}\]/);
  assert.doesNotMatch(sweep, /requestedMessageId.*trigger === "scheduled"/);
});

test("enabled reply categories require a non-empty model draft", async () => {
  const sweep = await read("functions/agent-sweep/index.ts");
  assert.match(sweep, /draft MUST be a non-empty reply/);
  assert.match(sweep, /Return draft: null ONLY when the category is not in that enabled list/);
});

test("auto-send requires a dedicated confirmation and safe policy", async () => {
  const api = await read("functions/agent-api/index.ts");
  const sweep = await read("functions/agent-sweep/index.ts");
  assert.match(api, /case "auto_send_prepare"/);
  assert.match(api, /case "auto_send_confirm"/);
  assert.match(api, /case "auto_send_disable"/);
  assert.doesNotMatch(sweep, /if \(profile\.auto_send === true\)/);
  assert.match(sweep, /deliveryDecision\(/);
  assert.match(api, /prepared_settings_version/);
  assert.match(api, /ia_confirm_auto_send/);
  assert.match(api, /settings changed; confirm again/);
});

test("OAuth callback never renders or selects a permanent API token", async () => {
  const oauth = await read("functions/gmail-oauth/index.ts");
  const api = await read("functions/agent-api/index.ts");
  assert.doesNotMatch(oauth, /freshUser|select\("api_token"\)|extension access token/i);
  assert.match(oauth, /state_hash/);
  assert.match(oauth, /completionRedirect/);
  assert.match(oauth, /caughtup_gmail/);
  assert.match(api, /access_type", "offline"/);
  assert.match(api, /prompt", "consent"/);
});

test("provider and database details are not returned in touched error envelopes", async () => {
  for (const path of [
    "functions/agent-api/index.ts",
    "functions/agent-sweep/index.ts",
    "functions/daily-digest/index.ts",
    "functions/gmail-oauth/index.ts",
  ]) {
    const source = await read(path);
    assert.doesNotMatch(source, /return\s+json\(\{\s*error:\s*(?!error\.message)[a-zA-Z]+Error?\.message/);
    assert.doesNotMatch(source, /await\s+\w+\.text\(\)/);
  }
  const api = await read("functions/agent-api/index.ts");
  assert.match(api, /error instanceof InputError\) return json\(\{ error: error\.message, code: "invalid_request" \}, 400\)/);
  assert.match(api, /return json\(\{ error: "request failed", code: "internal_error", request_id: requestId \}, 500\)/);
});

test("completed message claims are terminal", async () => {
  const migration = await read("migrations/20260721000002_stability_contract.sql");
  assert.match(migration, /ia_message_claims\.status = 'error'[\s\S]+ia_message_claims\.status = 'claimed'/);
  assert.doesNotMatch(migration, /where ia_message_claims\.status = 'error'\s+or ia_message_claims\.claimed_at/);
});

test("migration creates and locks every new service-role table", async () => {
  const migration = await read("migrations/20260721000002_stability_contract.sql");
  for (const table of [
    "ia_auto_send_challenges", "ia_settings_audit", "ia_sender_rules", "ia_media_kits",
    "ia_send_attempts", "ia_oauth_states", "ia_job_claims", "ia_message_claims",
  ]) {
    assert.match(migration, new RegExp(`create table if not exists ${table}`));
    assert.match(migration, new RegExp(`alter table ${table} enable row level security`));
  }
  assert.match(migration, /revoke all on[\s\S]+from anon, authenticated/);
});

test("extension-facing action contract is present", async () => {
  const api = await read("functions/agent-api/index.ts");
  for (const action of [
    "digest", "chat", "profile_get", "profile_set", "auto_send_prepare",
    "auto_send_confirm", "auto_send_disable", "draft_get", "send_draft", "sweep",
    "media_kit_list", "media_kit_upload_prepare", "media_kit_upload_complete",
    "media_kit_update", "media_kit_delete", "learning_reset", "gmail_connect_start",
  ]) assert.match(api, new RegExp(`case "${action}"`));
  assert.match(api, /body\.action === "auth_refresh"/);
});

test("irreversible provider mutations use terminal reconciliation states", async () => {
  const sweep = await read("functions/agent-sweep/index.ts");
  const digest = await read("functions/daily-digest/index.ts");
  const api = await read("functions/agent-api/index.ts");
  assert.ok(sweep.indexOf('status: "sending"') < sweep.indexOf('gmailPost(token, "/messages/send"'));
  assert.ok(sweep.indexOf('status: "sending"') < sweep.indexOf('gmailPost(token, "/drafts"'));
  assert.match(sweep, /providerMutationStarted \? "reconcile" : "error"/);
  assert.ok(digest.indexOf('status: "sending"') < digest.indexOf('https://gmail.googleapis.com/gmail/v1/users/me/messages/send'));
  assert.match(digest, /digestSendStarted \? "reconcile" : "error"/);
  assert.match(api, /code: "send_in_progress"/);
  assert.match(api, /existing\?\.status === "failed"[\s\S]+status: "claimed"/);
});

test("manual send uses a full live-draft preview fingerprint before claiming", async () => {
  const api = await read("functions/agent-api/index.ts");
  assert.match(api, /stablePayload\(payload\)/);
  assert.match(api, /\bto, cc, bcc\b/);
  assert.match(api, /attachments: flattened/);
  assert.ok(api.indexOf("currentDraft.preview_version !== previewVersion") < api.indexOf('from("ia_send_attempts").insert'));
  assert.match(api, /code: "draft_changed"/);
});

test("kit listing and labels remain owner scoped", async () => {
  const api = await read("functions/agent-api/index.ts");
  assert.match(api, /\.eq\("user_id", user\.id\)\.in\("id", selectedKitIds\)/);
  assert.match(api, /media_kit_label/);
  assert.match(api, /\.eq\("user_id", user\.id\)\.eq\("status", "active"\)/);
  assert.match(api, /recoverable: false/);
  assert.match(api, /cleanup_required/);
});

test("OAuth redirects require an exact configured extension allowlist", async () => {
  const api = await read("functions/agent-api/index.ts");
  const oauth = await read("functions/gmail-oauth/index.ts");
  assert.match(api, /allowedChromeRedirect\(redirectUri, CFG\["ia_allowed_extension_ids"\]/);
  assert.match(oauth, /allowedChromeRedirect\(claimed\.redirect_uri, CFG\["ia_allowed_extension_ids"\]/);
});

test("fresh runtime migration owns config and secret-at-runtime cron dispatch", async () => {
  const migration = await read("migrations/20260721000003_runtime_bootstrap.sql");
  assert.match(migration, /security definer[\s\S]+set search_path = ''/);
  assert.match(migration, /vault\.decrypted_secrets[\s\S]+ia_agent_cron_secret/);
  assert.match(migration, /revoke all on function public\.ia_get_config\(\) from public, anon, authenticated/);
  assert.doesNotMatch(migration, /x-agent-secret'\s*,\s*'[A-Za-z0-9_-]{20}/);
  assert.doesNotMatch(migration, /xkrpxvswdkreglmefuot/);
  assert.doesNotMatch(migration, /^select cron\.schedule/gm);
  assert.match(migration, /ia_install_dispatch_cron\(p_base_url text\)/);
  assert.match(migration, /caughtup-daily-digest/);
  assert.match(migration, /\^https:\/\/\[a-z0-9\]\{20\}\\\.supabase\\\.co\$/);
  assert.match(migration, /localhost\|127\\\.0\\\.0\\\.1\|\\\[::1\\\]\|host\\\.docker\\\.internal\|kong/);
  assert.doesNotMatch(migration, /https:\/\/\[a-z0-9\.\-\]/);
});

test("auto-send rechecks current profile version immediately before provider mutation", async () => {
  const sweep = await read("functions/agent-sweep/index.ts");
  const reread = sweep.indexOf('.select("reply_mode, auto_send, auto_send_confirmed_at');
  const send = sweep.indexOf('gmailPost(token, "/messages/send"');
  assert.ok(reread > 0 && reread < send);
  assert.match(sweep, /Number\(currentProfile\.settings_version\) !== Number\(profile\.settings_version\)/);
  assert.match(sweep, /if \(freshDecision !== "auto_send"\) decision = "draft"/);
});

test("one active job claim blocks different window keys and only stale claimed work expires", async () => {
  const migration = await read("migrations/20260721000002_stability_contract.sql");
  assert.match(migration, /ia_job_claims_one_active_uidx[\s\S]+where status in \('claimed', 'sending', 'sent', 'reconcile'\)/);
  assert.match(migration, /status = 'claimed' and created_at < now\(\) - interval '15 minutes'/);
  assert.match(migration, /exception when unique_violation/);
});

test("style learning requires an exact Gmail message association", async () => {
  const sweep = await read("functions/agent-sweep/index.ts");
  assert.match(sweep, /gmail_sent_message_id \?\? row\.gmail_draft_message_id/);
  assert.doesNotMatch(sweep, /sort\(\(a: any, b: any\).*internalDate/);
});

test("legacy media-kit seeder is inert", async () => {
  const seeder = await read("functions/seed-media-kit/index.ts");
  assert.match(seeder, /status:\s*410/);
  assert.doesNotMatch(seeder, /from\("ia_users"\)|raw\.githubusercontent|storage\.from/);
});
