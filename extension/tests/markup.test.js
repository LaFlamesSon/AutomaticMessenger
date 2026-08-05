"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const extensionDir = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(extensionDir, "popup.html"), "utf8");
const script = fs.readFileSync(path.join(extensionDir, "popup.js"), "utf8");
const css = fs.readFileSync(path.join(extensionDir, "popup.css"), "utf8");
const connectHtml = fs.readFileSync(path.join(extensionDir, "connect.html"), "utf8");
const connectScript = fs.readFileSync(path.join(extensionDir, "connect.js"), "utf8");
const connectCss = fs.readFileSync(path.join(extensionDir, "connect.css"), "utf8");
const allScripts = `${script}\n${connectScript}`;
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, "manifest.json"), "utf8"));

test("popup exposes exactly the five approved tabs and matching accessible panels", () => {
  const tabs = [...html.matchAll(/role="tab"[^>]+data-tab="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(tabs, ["today", "opportunities", "kits", "calendar", "settings"]);
  tabs.forEach((id) => {
    assert.match(html, new RegExp(`id="${id}"[^>]+role="tabpanel"`));
    assert.match(html, new RegExp(`aria-controls="${id}"`));
  });
  assert.match(script, /ArrowRight/);
  assert.match(script, /ArrowLeft/);
  assert.match(script, /if \(name === "calendar" && !calendarLoaded && !calendarLoading\) loadCalendar\(\)/);
});

test("popup IDs are unique", () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicates, []);
  const connectIds = [...connectHtml.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(connectIds).size, connectIds.length);
});

test("irreversible modes have explicit dialogs and live status", () => {
  assert.match(html, /id="sendDialog"/);
  assert.match(html, /id="previewRecipient"/);
  assert.match(html, /id="previewSubject"/);
  assert.match(html, /id="previewBody"/);
  assert.match(html, /id="previewCc"/);
  assert.match(html, /id="previewBcc"/);
  assert.match(html, /id="previewAttachments"/);
  assert.match(html, /id="autoSendDialog"/);
  assert.match(html, /I understand, turn it on/);
  assert.ok((html.match(/aria-live=/g) || []).length >= 8);
});

test("manual send retries persist and reuse one idempotency key", () => {
  assert.match(script, /MANUAL_SEND_KEYS_STORAGE/);
  assert.match(script, /idempotency_key:\s*pendingDraft\.idempotency_key/);
  assert.match(script, /Check send status/);
  assert.doesNotMatch(script, /const idempotencyKey = globalThis\.crypto/);
});

test("manual sweep follows completion automatically without exposing status mechanics", () => {
  assert.match(script, /MANUAL_SWEEP_ID_STORAGE/);
  assert.match(script, /request_id: requestId/);
  assert.match(script, /await forgetManualSweepRequestId\(\)/);
  assert.doesNotMatch(script, /Check sweep status/);
  assert.match(script, /already_in_progress/);
  assert.match(script, /setBusy\(button, true, "Sweeping…"\)/);
  assert.match(script, /baseline_finished_at: lastSweepRun\?\.finished_at \|\| null/);
  assert.match(script, /Core\.sweepRunChanged/);
  assert.match(script, /if \(manualSweepState\) void pollPendingSweep\(\)/);
  assert.match(script, /button\.dataset\.label = "Sweep now"/);
  assert.doesNotMatch(script, /api\("sweep", \{ request_id: globalThis\.crypto/);
  assert.match(script, /Core\.summarizeSweepResults\(result\)/);
  assert.match(script, /You're all caught up! \$\{sent\}; \$\{review\}/);
  assert.match(script, /setGlobalStatus\([^\n]+"success"\)/);
});

test("empty Today and successful sweeps use the requested caught-up states", () => {
  assert.match(script, /You're all caught up — nothing pending!/);
  assert.match(css, /\.global-status\.success/);
  assert.match(script, /Core\.deliveryState\(email\) !== "sent"/);
  assert.doesNotMatch(`${html}\n${script}\n${css}`, /duck/i);
});

test("Ask CaughtUp lives in Today while Opportunities is a working approval-only destination", () => {
  const todayPanel = html.match(/<section id="today"[\s\S]*?<section id="opportunities"/)?.[0] ?? "";
  assert.match(todayPanel, /id="askCaughtUpTitle"[^>]*>Ask CaughtUp/);
  assert.match(todayPanel, /id="chatForm"/);
  assert.match(todayPanel, /id="messages"[^>]+class="ask-messages hidden"/);
  assert.match(html, /id="tab-opportunities"[^>]+data-tab="opportunities"[^>]*>Opportunities/);
  assert.match(html, /id="opportunityProfileForm"/);
  assert.match(html, /id="opportunityAddForm"/);
  assert.match(html, /id="affiliateMetricForm"/);
  assert.match(html, /id="affiliateOpportunityForm"/);
  assert.match(html, /id="opportunitySourceSummary"/);
  assert.match(html, /id="opportunitySourceBadge"/);
  assert.match(html, /No affiliate marketplace feed is connected yet|Checking which sources are active/);
  assert.match(html, /Add an affiliate product manually/);
  assert.match(html, /does not import a marketplace catalog/);
  assert.match(html, /id="opportunityFormats"/);
  assert.match(html, /id="opportunityRegions"/);
  assert.match(html, /id="opportunityDraftDialog"/);
  assert.match(html, /Outreach always requires your review/);
  assert.match(script, /if \(name === "opportunities" && !opportunitiesLoaded && !opportunitiesLoading\) loadOpportunities\(\)/);
  assert.match(script, /api\("opportunity_prepare_draft"/);
  assert.match(script, /api\("opportunity_draft_get"/);
  assert.match(script, /api\("opportunity_send"/);
  assert.match(script, /api\("affiliate_metric_upsert"/);
  assert.match(script, /api\("affiliate_metric_delete"/);
  assert.match(script, /api\("affiliate_opportunity_create"/);
  assert.match(script, /opportunity\.ease_label/);
  assert.match(script, /opportunity\.score_components/);
  assert.match(script, /state\.affiliate_connections/);
  assert.match(script, /available_affiliate_providers/);
  assert.match(script, /No affiliate marketplace feed is connected yet/);
  assert.doesNotMatch(html, /id="tab-chat"|id="chat"[^>]+role="tabpanel"/);
  assert.match(script, /\["today", "opportunities", "kits", "calendar", "settings"\]/);
});

test("secondary tabs hydrate from cache and refresh without duplicate requests", () => {
  assert.match(script, /VIEW_CACHE_STORAGE/);
  assert.match(script, /function hydrateViewCache/);
  assert.match(script, /fillProfile\(currentProfile\)/);
  assert.match(script, /loadKits\(\{ quiet: hydrated\.kits \}\)/);
  assert.match(script, /loadCalendar\(\{ quiet: hydrated\.calendar \}\)/);
  assert.match(script, /if \(kitsLoading\) return/);
  assert.match(script, /if \(calendarLoading\) return/);
});

test("Today omits non-actionable Low priority and Filtered out aggregates", () => {
  const renderBlock = script.match(/function renderDigest\(emails\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(renderBlock, /\["urgent", "action_needed", "fyi"\]/);
  assert.doesNotMatch(renderBlock, /low_priority|spam_or_poor_fit|handled/);
});

test("expired Gmail authorization opens a real reconnect flow", () => {
  assert.match(script, /gmailReconnectRequired/);
  assert.match(script, /GMAIL_RECONNECT_STORAGE/);
  assert.match(script, /rememberGmailReconnectRequired/);
  assert.match(connectScript, /if \(providerTokens\)/);
  assert.doesNotMatch(connectScript, /profile\?\.gmail_connected !== true && providerTokens/);
  assert.match(connectScript, /profile\?\.gmail_connected !== true \|\| reconnectState\[GMAIL_RECONNECT_STORAGE\] === true/);
  assert.match(script, /error\.code === "gmail_reconnect_required"/);
  assert.match(script, /showSetup\(true, "Gmail access expired\.[^\n]+", "gmail"\)/);
  assert.match(connectScript, /startedWithoutSession && !providerHandoffCompleted/);
});

test("manual send requires an authoritative versioned preview", () => {
  assert.match(script, /api\("draft_get", \{ id: email\.id \}\)/);
  assert.match(script, /preview_version: pendingDraft\.preview_version/);
  assert.match(script, /Array\.isArray\(draft\.to\)/);
  assert.match(script, /Array\.isArray\(draft\.attachments\)/);
  assert.match(script, /previewAttachments/);
  assert.match(script, /code === "draft_changed"/);
  assert.match(script, /Draft changed in Gmail/);
});

test("kits form is labeled and bounded to approved client MIME types", () => {
  assert.match(html, /id="kitFile"[^>]+accept="application\/pdf,image\/jpeg,image\/png,image\/webp"/);
  assert.match(html, /for="kitLabel"/);
  assert.match(html, /for="kitDomains"/);
  assert.match(html, /id="kitAutoAttach"/);
  assert.match(html, /id="kitBrands"/);
  assert.match(html, /id="kitKeywords"/);
  assert.match(html, /id="kitEditDialog"/);
  assert.match(script, /brand_names: Core\.normalizeTags/);
  assert.match(script, /keywords: Core\.normalizeTags/);
});

test("dynamic rendering avoids innerHTML", () => {
  assert.doesNotMatch(script, /\.innerHTML\s*=/);
  assert.match(script, /\.textContent\s*=/);
});

test("client targets the audited API actions", () => {
  [
    "digest", "chat", "draft_get", "send_draft", "sweep", "profile_get", "profile_set",
    "auto_send_prepare", "auto_send_confirm", "auto_send_disable", "media_kit_list",
    "media_kit_upload_prepare", "media_kit_upload_complete", "media_kit_update",
    "media_kit_delete", "learning_reset", "gmail_connect_provider", "gmail_connect_start",
    "auth_refresh", "calendar_get", "calendar_set", "booking_create", "booking_delete",
    "opportunities_get", "opportunity_refresh", "opportunity_preferences_set", "brand_relationship_set",
    "opportunity_create", "opportunity_update", "opportunity_prepare_draft", "opportunity_draft_get", "opportunity_send",
    "affiliate_metric_upsert", "affiliate_metric_delete", "affiliate_opportunity_create",
  ].forEach((action) => assert.ok(allScripts.includes(`"${action}"`), `missing ${action}`));
});

test("Calendar conditionally exposes validated contact and availability controls", () => {
  assert.match(html, /id="contactEmailOnly"[^>]+value="email_only"/);
  assert.match(html, /id="contactScheduledCall"[^>]+value="scheduled_call"/);
  assert.match(html, /id="contactPhone"[^>]+value="phone"/);
  assert.match(html, /id="calendarPhone"[^>]+type="tel"/);
  assert.match(html, /id="calendarBookingUrl"[^>]+type="url"/);
  assert.match(html, /id="availabilityRows"/);
  assert.match(html, /Set one time window per day/);
  assert.match(script, /Core\.validateCalendarSettings\(fields\)/);
  assert.match(script, /calendarPhone"\)\.required = phoneMode/);
  assert.match(script, /availability-\$\{day\}-start`\)\.required = scheduledMode && enabled\.checked/);
  assert.match(script, /classList\.toggle\("hidden", !scheduledMode\)/);
});

test("Calendar discloses internal-only conflict protection and Review fallback", () => {
  assert.match(html, /prevents conflicts between bookings saved here/);
  assert.match(html, /not yet synced with Google Calendar or other external calendars/);
  assert.match(html, /returns replies to Review mode/);
  assert.match(script, /applyCalendarReviewFallback\(result\)/);
  assert.match(script, /updateModeBadge\("draft_only"\)/);
  assert.match(script, /auto_send_disabled !== true/);
});

test("internal bookings are timezone-aware, idempotent, and deletions are confirmed", () => {
  assert.match(html, /id="bookingStart" type="datetime-local"/);
  assert.match(html, /id="bookingEnd" type="datetime-local"/);
  assert.match(script, /Core\.zonedLocalToIso/);
  assert.match(script, /BOOKING_REQUEST_STORAGE/);
  assert.match(script, /request_id: pendingBookingRequest\.request_id/);
  assert.match(script, /\^booking-\[a-zA-Z0-9-\]/);
  assert.match(script, /confirm\(`Delete the internal booking/);
  assert.match(html, /Existing bookings remain manageable in every mode/);
  assert.match(html, /id="bookingActionStatus"[^>]+aria-live="polite"/);
  assert.doesNotMatch(script, /internalBookings"\)\.classList\.toggle\("hidden"/);
  assert.match(script, /canCreateBooking = scheduledMode && currentCalendar\?\.contact_mode === "scheduled_call"/);
});

test("Google onboarding runs in a durable extension page with a safe Gmail fallback", () => {
  assert.match(script, /chrome\.tabs\.create\(\{ url: chrome\.runtime\.getURL\("connect\.html"\) \}\)/);
  assert.doesNotMatch(script, /launchWebAuthFlow/);
  assert.match(connectHtml, /Keep this page open/);
  assert.match(connectHtml, /Connecting does not send any email/);
  assert.match(connectScript, /chrome\.identity\.getRedirectURL/);
  assert.match(connectScript, /chrome\.identity\.launchWebAuthFlow/);
  assert.match(connectScript, /SUPABASE_AUTH/);
  assert.match(connectScript, /openid email profile https:\/\/www\.googleapis\.com\/auth\/gmail\.modify/);
  assert.match(connectScript, /authorize\.searchParams\.set\("access_type", "offline"\)/);
  assert.match(connectScript, /authorize\.searchParams\.set\("prompt", "consent"\)/);
  assert.match(connectScript, /auth\.provider_token/);
  assert.match(connectScript, /auth\.provider_refresh_token/);
  assert.match(connectScript, /api\("gmail_connect_provider", providerTokens\)/);
  assert.match(connectScript, /"gmail_connect_start"/);
  assert.match(connectScript, /gmailAuth\.caughtup_gmail/);
  const persistedSessions = [...connectScript.matchAll(/await saveSession\(\{([\s\S]*?)\}\);/g)].map((match) => match[1]);
  assert.ok(persistedSessions.length >= 2);
  persistedSessions.forEach((persisted) => assert.doesNotMatch(persisted, /provider_token|provider_refresh_token/));
  assert.doesNotMatch(html, /tokenInput|Paste your access token/i);
  assert.doesNotMatch(allScripts, /x-api-token/);
  assert.match(connectCss, /prefers-reduced-motion/);
});

test("authenticated users can resume Gmail consent and identity labels stay distinct", () => {
  assert.match(script, /gmail_connected !== true/);
  assert.match(script, /showSetup\(true, gmailReconnectRequired \? "Gmail access expired\. Reconnect Gmail to continue\." : "", "gmail"\)/);
  assert.match(script, /gmailAddress\.toLowerCase\(\) !== appEmail\.toLowerCase\(\)/);
});

test("timezone is configurable and sign out discloses that scheduled work continues", () => {
  assert.match(html, /id="f_timezone"[^>]+maxlength="80"/);
  assert.doesNotMatch(html, /id="f_timezone"[^>]+readonly/);
  assert.match(script, /Core\.isValidTimezone/);
  assert.match(html, /Scheduled CaughtUp and Gmail work continues/);
  assert.match(html, /id="signOut"[^>]*>Sign out</);
  assert.doesNotMatch(html, /id="disconnect"/);
});

test("standing rules visibly force Review mode", () => {
  assert.match(html, /free-text rule is active, replies stay in Review/);
  assert.match(script, /result\.auto_send_disabled === true/);
  assert.match(script, /result\.reply_mode === "draft_only"/);
  assert.match(script, /standingRulesRequireReview = Boolean\(fields\.custom_rules\.trim\(\)\)/);
  assert.match(script, /desiredMode === "auto_send" && standingRulesRequireReview/);
  assert.match(script, /Standing rules keep replies in Review/);
});

test("selecting Auto-send immediately enters the save and confirmation flow", () => {
  assert.match(html, /id="modeSetupStatus"/);
  assert.match(html, /Sweep now sends every reply that passes safety/);
  assert.match(script, /modeAuto"\)\.addEventListener\("change"/);
  assert.match(script, /selectDefaultAutoSendCategories\(\)/);
  assert.match(script, /settingsForm"\)\.requestSubmit\(\)/);
  assert.match(script, /Auto-send is active\. Sweep now sends every reply that passes safety/);
});

test("Chat writing-style updates are reflected in extension state", () => {
  assert.match(script, /result\.profile_updated\?\.tone/);
  assert.match(script, /currentProfile\.tone = result\.profile_updated\.tone/);
  assert.match(script, /Writing style updated for future replies/);
});

test("manifest requests only the extension capabilities used by this UI", () => {
  assert.deepEqual(manifest.permissions.sort(), ["identity", "storage"]);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.4.2");
});

test("focus and reduced-motion styles are present", () => {
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});
