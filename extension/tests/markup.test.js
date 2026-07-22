"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const extensionDir = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(extensionDir, "popup.html"), "utf8");
const script = fs.readFileSync(path.join(extensionDir, "popup.js"), "utf8");
const css = fs.readFileSync(path.join(extensionDir, "popup.css"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, "manifest.json"), "utf8"));

test("popup exposes exactly the five approved tabs and matching accessible panels", () => {
  const tabs = [...html.matchAll(/role="tab"[^>]+data-tab="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(tabs, ["today", "chat", "kits", "calendar", "settings"]);
  tabs.forEach((id) => {
    assert.match(html, new RegExp(`id="${id}"[^>]+role="tabpanel"`));
    assert.match(html, new RegExp(`aria-controls="${id}"`));
  });
  assert.match(script, /ArrowRight/);
  assert.match(script, /ArrowLeft/);
  assert.match(script, /if \(name === "calendar" && !calendarLoaded\) loadCalendar\(\)/);
});

test("popup IDs are unique", () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicates, []);
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

test("manual sweep retries persist one request id until confirmed completion", () => {
  assert.match(script, /MANUAL_SWEEP_ID_STORAGE/);
  assert.match(script, /request_id: requestId/);
  assert.match(script, /await forgetManualSweepRequestId\(\)/);
  assert.match(script, /Check sweep status/);
  assert.match(script, /already_in_progress/);
  assert.match(script, /setBusy\(button, true, "Sweeping…"\)/);
  assert.doesNotMatch(script, /api\("sweep", \{ request_id: globalThis\.crypto/);
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
    "media_kit_delete", "learning_reset", "gmail_connect_start",
    "auth_refresh", "calendar_get", "calendar_set", "booking_create", "booking_delete",
  ].forEach((action) => assert.ok(script.includes(`"${action}"`), `missing ${action}`));
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

test("Google onboarding uses extension-owned redirect and never token paste", () => {
  assert.match(script, /chrome\.identity\.getRedirectURL/);
  assert.match(script, /SUPABASE_AUTH/);
  assert.match(script, /"gmail_connect_start"/);
  assert.match(script, /caughtup_gmail/);
  assert.doesNotMatch(html, /tokenInput|Paste your access token/i);
  assert.doesNotMatch(script, /x-api-token/);
});

test("authenticated users can resume Gmail consent and identity labels stay distinct", () => {
  assert.match(script, /gmail_connected !== true/);
  assert.match(script, /showSetup\(true, "", "gmail"\)/);
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

test("manifest requests only the extension capabilities used by this UI", () => {
  assert.deepEqual(manifest.permissions.sort(), ["identity", "storage"]);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.3.0");
});

test("focus and reduced-motion styles are present", () => {
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});
