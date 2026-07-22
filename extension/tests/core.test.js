"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../core.js");

test("new and legacy profiles default safely to Review", () => {
  assert.equal(Core.normalizeProfile({}).reply_mode, "draft_only");
  assert.equal(Core.normalizeProfile({ auto_send: false }).reply_mode, "draft_only");
  assert.equal(Core.normalizeProfile({ auto_send: true }).reply_mode, "auto_send");
  assert.equal(Core.normalizeProfile({ reply_mode: "unexpected", auto_send: true }).reply_mode, "draft_only");
});

test("profile defaults expose bounded required questions and draft categories", () => {
  const profile = Core.normalizeProfile({});
  assert.deepEqual(profile.always_ask, Core.REQUIRED_QUESTIONS.map((item) => item.value));
  assert.deepEqual(profile.draft_categories, ["urgent", "action_needed"]);
  assert.deepEqual(profile.auto_send_categories, []);
});

test("delivery state supports audited and legacy fields", () => {
  assert.equal(Core.deliveryState({ delivery_status: "sent" }), "sent");
  assert.equal(Core.deliveryState({ auto_sent: true }), "sent");
  assert.equal(Core.deliveryState({ delivery_status: "draft" }), "draft");
  assert.equal(Core.deliveryState({ draft_created: true }), "draft");
  assert.equal(Core.deliveryState({}), "none");
});

test("media validation accepts supported bounded files", () => {
  assert.equal(Core.validateMediaFile({ type: "application/pdf", size: 500_000 }).ok, true);
  assert.equal(Core.validateMediaFile({ type: "image/png", size: 7_999_999 }).ok, true);
  assert.equal(Core.validateMediaFile({ type: "text/html", size: 500 }).ok, false);
  assert.equal(Core.validateMediaFile({ type: "application/pdf", size: 8_000_001 }).ok, false);
  assert.equal(Core.validateMediaFile({ type: "application/pdf", size: 0 }).ok, false);
});

test("domain normalization removes invalid and duplicate values", () => {
  assert.deepEqual(
    Core.normalizeDomains("@Brand.com, brand.com agency.co not-a-domain"),
    ["brand.com", "agency.co"],
  );
});

test("brand and keyword tags are bounded, deduplicated, and timezone is IANA-valid", () => {
  assert.deepEqual(Core.normalizeTags("Glow Co, glow co, skincare,  video  work"), ["Glow Co", "skincare", "video work"]);
  assert.equal(Core.isValidTimezone("America/Los_Angeles"), true);
  assert.equal(Core.isValidTimezone("Not/A_Timezone"), false);
});

test("calendar contact fields use strict phone, HTTPS URL, and mode validation", () => {
  assert.equal(Core.isValidPhone("+14155552671"), true);
  assert.equal(Core.isValidPhone("415-555-2671"), false);
  assert.equal(Core.isValidBookingUrl("https://cal.example.com/name"), true);
  assert.equal(Core.isValidBookingUrl("http://cal.example.com/name"), false);
  assert.equal(Core.isValidBookingUrl("https://user:pass@cal.example.com"), false);
  assert.equal(Core.validateCalendarSettings({
    contact_mode: "phone", phone_number: "", booking_url: null,
    timezone: "America/Los_Angeles", weekly_availability: [],
  }).ok, false);
  assert.equal(Core.validateCalendarSettings({
    contact_mode: "scheduled_call", booking_url: null, timezone: "UTC",
    weekly_availability: [
      { day: 1, start: "09:00", end: "10:00" },
      { day: 1, start: "11:00", end: "12:00" },
    ],
  }).ok, false);
  assert.equal(Core.validateCalendarSettings({
    contact_mode: "scheduled_call", phone_number: null, booking_url: null,
    timezone: "America/Los_Angeles", weekly_availability: [],
  }).ok, false);
});

test("weekly availability normalizes valid same-day windows", () => {
  assert.deepEqual(Core.normalizeWeeklyAvailability([
    { day: 5, start: "13:00", end: "17:00" },
    { day: 1, start: "09:00", end: "12:00" },
    { day: 8, start: "09:00", end: "10:00" },
    { day: 2, start: "18:00", end: "10:00" },
  ]), [
    { day: 1, start: "09:00", end: "12:00" },
    { day: 5, start: "13:00", end: "17:00" },
  ]);
  assert.equal(Core.validateCalendarSettings({
    contact_mode: "scheduled_call", booking_url: null, timezone: "UTC",
    weekly_availability: [
      { day: 1, start: "09:00", end: "12:00" },
      { day: 1, start: "11:00", end: "13:00" },
    ],
  }).ok, false);
  assert.deepEqual(Core.normalizeWeeklyAvailability([{ day: 1, start: "09:00extra", end: "12:00" }]), []);
});

test("booking local times convert using the configured IANA timezone", () => {
  assert.equal(Core.zonedLocalToIso("2026-07-21T09:00", "America/Los_Angeles"), "2026-07-21T16:00:00.000Z");
  assert.equal(Core.zonedLocalToIso("2026-03-08T02:30", "America/Los_Angeles"), null);
  assert.match(Core.formatBookingRange({
    start_at: "2026-07-21T16:00:00.000Z",
    end_at: "2026-07-21T16:30:00.000Z",
  }, "America/Los_Angeles"), /9:00.*9:30/);
});

test("authentication headers use only a short-lived session", () => {
  assert.deepEqual(Core.authHeaders({ access_token: "session-token" }), {
    "Content-Type": "application/json",
    Authorization: "Bearer session-token",
  });
  assert.deepEqual(Core.authHeaders(null), { "Content-Type": "application/json" });
});

test("session refresh recognizes epoch and ISO expiries", () => {
  const now = Date.parse("2026-07-20T12:00:00Z");
  assert.equal(Core.shouldRefreshSession({ refresh_token: "r", expires_at: now / 1000 + 30 }, now), true);
  assert.equal(Core.shouldRefreshSession({ refresh_token: "r", expires_at: "2026-07-20T12:05:00Z" }, now), false);
  assert.equal(Core.shouldRefreshSession({ expires_at: now }, now), false);
});

test("active Auto-send policy changes require a fresh confirmation", () => {
  const current = {
    auto_send_categories: ["urgent"],
    draft_categories: ["urgent", "action_needed"],
    always_ask: ["budget range", "timeline"],
  };
  assert.equal(Core.autoSendPolicyChanged(current, {
    auto_send_categories: ["urgent"],
    draft_categories: ["action_needed", "urgent"],
    always_ask: ["timeline", "budget range"],
  }), false);
  assert.equal(Core.autoSendPolicyChanged(current, { ...current, auto_send_categories: ["urgent", "action_needed"] }), true);
  assert.equal(Core.autoSendPolicyChanged(current, { ...current, always_ask: ["timeline"] }), true);
  assert.equal(Core.autoSendPolicyChanged(current, { ...current, custom_rules: "- Never suggest Friday calls" }), true);
});

test("manual send key remains stable for the same draft across retries and reload state", () => {
  let generated = 0;
  const first = Core.ensureManualSendKey({}, "draft-123", () => {
    generated += 1;
    return "11111111-2222-3333-4444-555555555555";
  });
  const retry = Core.ensureManualSendKey(first.keys, "draft-123", () => {
    generated += 1;
    return "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  });
  assert.equal(first.key, "manual-send:11111111-2222-3333-4444-555555555555");
  assert.equal(retry.key, first.key);
  assert.equal(retry.created, false);
  assert.equal(Core.findManualSendKey(first.keys, "draft-123"), first.key);
  assert.equal(generated, 1);
});

test("invalid persisted manual-send keys are replaced safely", () => {
  const result = Core.ensureManualSendKey(
    { "draft-123": "bad key with spaces" },
    "draft-123",
    () => "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  );
  assert.equal(result.created, true);
  assert.equal(result.key, "manual-send:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  assert.equal(Core.findManualSendKey({ "draft-123": "bad key with spaces" }, "draft-123"), null);
});

test("manual sweep request id remains stable across timeout retries and popup reloads", () => {
  let generated = 0;
  const first = Core.ensureSweepRequestId(null, () => {
    generated += 1;
    return "11111111-2222-3333-4444-555555555555";
  });
  const retry = Core.ensureSweepRequestId(first.requestId, () => {
    generated += 1;
    return "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  });
  assert.equal(first.requestId, "manual-sweep:11111111-2222-3333-4444-555555555555");
  assert.equal(retry.requestId, first.requestId);
  assert.equal(retry.created, false);
  assert.equal(generated, 1);
});

test("unsafe provider details are not used for unknown errors", () => {
  assert.equal(Core.safeErrorMessage(new Error("secret provider response")), "CaughtUp couldn't complete that. Try again.");
  assert.match(Core.safeErrorMessage(new Core.ApiError("", 401, "unauthorized")), /session expired/i);
});
