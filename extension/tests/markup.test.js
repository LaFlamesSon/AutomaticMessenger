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
const backgroundScript = fs.readFileSync(path.join(extensionDir, "background.js"), "utf8");
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

test("automatic forwarding replaces manual inbox reads while Refresh reloads processed state", () => {
  assert.match(html, /id="refreshBtn"[^>]*>Refresh<\/button>/);
  assert.doesNotMatch(html, /id="sweepBtn"/);
  assert.match(script, /await loadDigest\(\)/);
  assert.match(script, /intakeGateActive/);
  assert.match(script, /if \(intakeGateActive\) \{[\s\S]*?Intake status updated\.[\s\S]*?return;/);
  assert.match(script, /New forwarded email is processed automatically/);
  assert.doesNotMatch(script, /api\("sweep"|manualSweepState|MANUAL_SWEEP_ID_STORAGE/);
});

test("empty Today and forwarded refreshes use the requested caught-up states", () => {
  assert.match(script, /nothing pending!/);
  assert.match(css, /\.global-status\.success/);
  assert.match(script, /Core\.deliveryState\(email\) !== "sent"/);
  assert.doesNotMatch(`${html}\n${script}\n${css}`, /duck/i);
});

test("Ask CaughtUp lives in Today while Opportunities remains unavailable until launch", () => {
  const todayPanel = html.match(/<section id="today"[\s\S]*?<section id="opportunities"/)?.[0] ?? "";
  assert.match(todayPanel, /id="askCaughtUpTitle"[^>]*>Ask CaughtUp/);
  assert.match(todayPanel, /id="chatForm"/);
  assert.match(html, /id="tab-opportunities"[^>]+aria-disabled="true"[^>]+disabled/);
  assert.match(html, /id="opportunityControls"[^>]+hidden/);
  assert.doesNotMatch(html, /id="opportunityDraftDialog"/);
  assert.doesNotMatch(script, /opportunity_draft_get|opportunity_send/);
  assert.match(script, /if \(!PANELS\.includes\(name\) \|\| name === "opportunities"\) return/);
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
  const renderBlock = script.match(/function renderTodayFeed\(emails, negotiations = \[\]\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(renderBlock, /\["urgent", "action_needed", "fyi"\]/);
  assert.doesNotMatch(renderBlock, /low_priority|spam_or_poor_fit|handled/);
});

test("expired Gmail authorization opens a real reconnect flow", () => {
  assert.match(script, /gmailReconnectRequired/);
  assert.match(script, /GMAIL_RECONNECT_STORAGE/);
  assert.match(script, /rememberGmailReconnectRequired/);
  assert.doesNotMatch(connectScript, /providerTokens|providerHandoff/);
  assert.match(connectScript, /profile\?\.gmail_connected !== true \|\| reconnectState\[GMAIL_RECONNECT_STORAGE\] === true/);
  assert.match(script, /code === "gmail_reconnect_required"/);
  assert.match(script, /showSetup\(true, gmailReconnectRequired \? "Gmail access expired\. Reconnect Gmail to continue\." : "", "gmail"\)/);
  assert.match(connectScript, /api\("gmail_connect_start"/);
});

test("manual send requires an authoritative versioned CaughtUp draft preview", () => {
  assert.match(script, /api\("forwarded_draft_get"/);
  assert.match(script, /preview_version: pendingDraft\.preview_version/);
  assert.match(script, /Array\.isArray\(draft\.to\)/);
  assert.match(script, /Array\.isArray\(draft\.attachments\)/);
  assert.match(script, /previewAttachments/);
  assert.match(script, /code === "draft_changed"/);
  assert.match(html, /<textarea id="previewBody"/);
  assert.match(html, /id="previewKit"/);
  assert.match(html, /id="saveDraftChanges"/);
  assert.match(script, /forwarded_draft_update/);
  assert.doesNotMatch(script, /"draft_get"|"draft_update"|"send_draft"/);
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

test("client targets the audited send-only API actions", () => {
  [
    "digest", "chat", "profile_get", "profile_set", "auto_send_prepare", "auto_send_confirm", "auto_send_disable",
    "media_kit_list", "media_kit_rate_update", "media_kit_upload_prepare", "media_kit_upload_complete",
    "media_kit_update", "media_kit_delete", "learning_reset", "gmail_connect_start", "auth_refresh",
    "calendar_get", "calendar_set", "booking_create", "booking_delete", "opportunities_get", "opportunity_refresh",
    "opportunity_preferences_set", "brand_relationship_set", "opportunity_create", "opportunity_update",
    "affiliate_metric_upsert", "affiliate_metric_delete", "affiliate_opportunity_create",
    "tiktok_connect_start", "tiktok_disconnect", "negotiation_dismiss",
    "forwarding_setup_get", "forwarding_setup_start", "forwarding_setup_activate", "forwarding_setup_disable",
    "forwarding_test_send", "forwarded_draft_get", "forwarded_draft_update", "forwarded_send",
  ].forEach((action) => assert.ok(allScripts.includes(`"${action}"`), `missing ${action}`));
  assert.doesNotMatch(allScripts, /"(?:draft_get|draft_update|send_draft|sweep|opportunity_draft_get|opportunity_send|negotiation_test_draft_create)"/);
});

test("negotiations share the Today timeline and only forwarded drafts expose review controls", () => {
  assert.match(script, /renderTodayFeed\(result\.emails \|\| \[\], result\.negotiations \|\| \[\]\)/);
  assert.match(script, /function negotiationTier/);
  assert.match(script, /What this is about/);
  assert.match(script, /Preview proposed reply/);
  assert.match(script, /api\("negotiation_dismiss"/);
  assert.match(script, /if \(isForwardedDraft\(deal\.draft_email\)\)/);
  assert.doesNotMatch(script, /negotiation_test_draft_create|Create draft|gmail_draft_id/);
  assert.match(script, /sendDraftFromCard/);
  assert.match(css, /\.negotiation-card\.deal-bad/);
});

test("ordinary forwarded cards hide reply text and offer compact verified send", () => {
  const renderer = script.match(/function renderEmailCard\(email\) \{([\s\S]*?)\n\}\n\nfunction renderDraftAttachments/)?.[1] || "";
  assert.doesNotMatch(renderer, /appendReplyDetails|Proposed reply/);
  assert.match(script, /api\("forwarded_draft_get"/);
  assert.match(script, /Send this reply through Gmail to/);
  assert.match(script, /api\("forwarded_send"/);
  assert.match(script, /preview_version: draft\.preview_version/);
  assert.doesNotMatch(script, /api\("(?:send_draft|draft_get)"/);
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

test("Calendar explains CaughtUp booking conflict protection without implying Google access", () => {
  assert.match(html, /blocks overlapping times for bookings saved here/);
  assert.doesNotMatch(html, /Google Calendar|external calendars/);
  assert.match(html, /returns replies to Review mode/);
  assert.match(script, /applyCalendarReviewFallback\(result\)/);
  assert.match(script, /updateModeBadge\("draft_only"\)/);
  assert.match(script, /auto_send_disabled !== true/);
});

test("bookings are timezone-aware, idempotent, and deletions are confirmed", () => {
  assert.match(html, /id="bookingStart" type="datetime-local"/);
  assert.match(html, /id="bookingEnd" type="datetime-local"/);
  assert.match(script, /Core\.zonedLocalToIso/);
  assert.match(script, /BOOKING_REQUEST_STORAGE/);
  assert.match(script, /request_id: pendingBookingRequest\.request_id/);
  assert.match(script, /\^booking-\[a-zA-Z0-9-\]/);
  assert.match(script, /confirm\(`Delete this booking/);
  assert.match(html, /Existing bookings remain manageable in every mode/);
  assert.match(html, /id="bookingActionStatus"[^>]+aria-live="polite"/);
  assert.doesNotMatch(script, /internalBookings"\)\.classList\.toggle\("hidden"/);
  assert.match(script, /canCreateBooking = scheduledMode && currentCalendar\?\.contact_mode === "scheduled_call"/);
});

test("Google onboarding separates identity from send-only Gmail consent", () => {
  assert.match(script, /chrome\.tabs\.create\(\{ url: chrome\.runtime\.getURL\("connect\.html"\) \}\)/);
  assert.doesNotMatch(script, /launchWebAuthFlow/);
  assert.match(connectHtml, /Keep this page open/);
  assert.match(connectHtml, /Connecting does not send any email/);
  assert.match(connectScript, /chrome\.identity\.getRedirectURL/);
  assert.match(connectScript, /chrome\.identity\.launchWebAuthFlow/);
  assert.match(connectScript, /SUPABASE_AUTH/);
  assert.match(connectScript, /authorize\.searchParams\.set\("scopes", "openid email profile"\)/);
  assert.match(connectScript, /authorize\.searchParams\.set\("prompt", "select_account"\)/);
  assert.doesNotMatch(connectScript, /gmail\.modify|provider_token|provider_refresh_token/);
  assert.match(connectScript, /Core\.normalizeAuthSession\(auth\)/);
  assert.match(connectScript, /"gmail_connect_start"/);
  assert.match(connectScript, /gmailAuth\.caughtup_gmail/);
  assert.match(connectScript, /searchParams\.get\("flow"\)/);
  assert.match(connectScript, /"tiktok_connect_start"/);
  assert.match(connectScript, /caughtup_tiktok/);
  assert.match(connectScript, /const normalized = Core\.normalizeAuthSession\(nextSession\)/);
  assert.match(connectScript, /chrome\.storage\.local\.set\(\{ caughtup_session: session \}\)/);
  const saveSessionBody = connectScript.match(/async function saveSession\(nextSession\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.doesNotMatch(saveSessionBody, /provider_token|provider_refresh_token/);
  assert.doesNotMatch(html, /tokenInput|Paste your access token/i);
  assert.doesNotMatch(allScripts, /x-api-token/);
  assert.match(connectCss, /prefers-reduced-motion/);
});

test("temporary Gmail send probe is absent from production onboarding", () => {
  assert.match(connectHtml, /id="safety"/);
  assert.doesNotMatch(connectScript, /gmail-send-probe|gmail_send_probe|runGmailSendProbe|signInForGmailSendProbe/);
});

test("saved sessions stay in the app through transient startup and refresh failures", () => {
  assert.match(script, /Core\.normalizeAuthSession\(local\.caughtup_session\)/);
  assert.match(script, /Core\.isTerminalSessionError\(refreshError\)/);
  assert.match(script, /async function readApi/);
  assert.match(script, /if \(!Core\.isTransientApiError\(error\)\) throw error/);
  assert.match(script, /const profileResult = await readApi\("profile_get"\)/);
  assert.match(script, /stateCard\("todayStatus", Core\.safeErrorMessage\(error\), "error", initializePopup\)/);
  assert.doesNotMatch(script, /showSetup\(true, Core\.safeErrorMessage\(error\), "retry"\)/);
  assert.doesNotMatch(script, /dataset\.action = "retry"/);
});

test("all extension surfaces serialize rotating session refresh through the background worker", () => {
  assert.match(backgroundScript, /let refreshInFlight = null/);
  assert.match(backgroundScript, /message\?\.type !== "caughtup-refresh-session"/);
  assert.match(backgroundScript, /if \(refreshInFlight\) return refreshInFlight/);
  assert.match(backgroundScript, /ensureAlarm\(\);/);
  assert.match(script, /chrome\.runtime\.sendMessage\(\{ type: "caughtup-refresh-session", force: true \}\)/);
  assert.match(connectScript, /chrome\.runtime\.sendMessage\(\{ type: "caughtup-refresh-session", force: true \}\)/);
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
  assert.match(html, /Qualifying replies send automatically as forwarded email arrives/);
  assert.match(script, /modeAuto"\)\.addEventListener\("change"/);
  assert.match(script, /selectDefaultAutoSendCategories\(\)/);
  assert.match(script, /settingsForm"\)\.requestSubmit\(\)/);
  assert.match(script, /Auto-send is active\. Qualifying replies send automatically as forwarded email arrives/);
});

test("forwarding setup, controlled test, and disconnect are complete guided flows", () => {
  for (const id of ["forwardingCard", "forwardingAddress", "startForwarding", "openGmailForwarding", "openForwardingConfirmation", "activateForwarding", "runForwardingTest", "disableForwarding"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const id of ["setupIntake", "setupIntakeAction", "setupIntakeAddress"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /id="setupIntakeAction"[^>]*>Turn on CaughtUp</);
  assert.match(connectHtml, /id="intakePrimary"[^>]*>Turn on CaughtUp</);
  assert.match(script, /inbound_forwarding_ready !== true/);
  assert.doesNotMatch(script, /inbound_forwarding_ready !== true[\s\S]*forwardingTestPassed\(forwardingSnapshot/);
  assert.match(script, /showSetup\(true, "", "forwarding"\)/);
  assert.match(script, /Turn on CaughtUp/);
  assert.match(script, /api\("forwarding_setup_start"\)/);
  assert.match(script, /navigator\.clipboard\.writeText/);
  assert.match(script, /api\("forwarding_setup_activate", \{ confirm: true \}\)/);
  assert.match(script, /api\("forwarding_test_send"/);
  assert.match(script, /delivery_target: "inbound_alias"/);
  assert.match(script, /shouldPollForwarding/);
  assert.match(script, /verification_received/);
  assert.match(script, /api\("forwarding_setup_disable", \{ confirm: true \}\)/);
  assert.match(connectScript, /beginForwardingSetup/);
  assert.match(connectScript, /api\("forwarding_setup_start"\)/);
  assert.match(connectScript, /Turn on CaughtUp/);
  assert.match(connectScript, /api\("forwarding_test_send"/);
  assert.doesNotMatch(connectHtml, /id="openGmailForwarding"/);
});

test("Chat writing-style updates are reflected in extension state", () => {
  assert.match(script, /result\.profile_updated\?\.tone/);
  assert.match(script, /currentProfile\.tone = result\.profile_updated\.tone/);
  assert.match(script, /currentProfile\.settings_version = result\.profile_updated\.settings_version/);
  assert.match(script, /Remembered for future replies/);
  assert.match(script, /Writing style updated for future replies/);
});

test("manifest requests only the extension capabilities used by this UI", () => {
  assert.deepEqual(manifest.permissions.sort(), ["alarms", "identity", "storage"]);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.6.3");
  assert.equal(manifest.background.service_worker, "background.js");
});

test("background worker refreshes sessions but never signs the user out", () => {
  const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  assert.match(background, /importScripts\("core\.js"\)/);
  assert.match(background, /chrome\.alarms\.create/);
  assert.match(background, /auth_refresh/);
  assert.match(background, /refresh_token !== session\.refresh_token/);
  assert.doesNotMatch(background, /storage\.local\.remove/);
});

test("focus and reduced-motion styles are present", () => {
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});
