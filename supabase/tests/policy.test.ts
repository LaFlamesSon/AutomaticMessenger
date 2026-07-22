import assert from "node:assert/strict";
import test from "node:test";
import {
  applyContactPreference,
  bookingWithinAvailability,
  contactSafetyViolations,
  deliveryDecision,
  draftSafetyViolations,
  findVerifiedOpenSlots,
  finalizePortfolioDraft,
  localScheduleWindow,
  normalizeWeeklyAvailability,
  safeCalendarPreference,
  normalizedStringList,
  selectMediaKit,
} from "../functions/_shared/policy.ts";
import { parseStrictRecipient, quoteFilename, sanitizeHeader, sanitizeMessageIds } from "../functions/_shared/mime.ts";
import { allowedChromeRedirect } from "../functions/_shared/oauth.ts";

test("Review is the default and confirmed auto-send is narrow", () => {
  const base = { draft_categories: ["urgent", "action_needed"] };
  assert.equal(deliveryDecision({ category: "urgent", draft: "Thanks for the brief.", profile: base }), "draft");
  const confirmed = {
    ...base,
    reply_mode: "auto_send",
    auto_send: true,
    auto_send_confirmed_at: new Date().toISOString(),
    auto_send_policy_version: "v1",
    auto_send_categories: ["action_needed"],
  };
  assert.equal(deliveryDecision({ category: "urgent", draft: "Thanks for the brief.", profile: confirmed }), "draft");
  assert.equal(deliveryDecision({ category: "action_needed", draft: "Thanks for the brief.", profile: confirmed, confidence: 0.95 }), "auto_send");
  assert.equal(deliveryDecision({ category: "action_needed", draft: "Thanks for the brief.", profile: confirmed }), "draft");
  assert.equal(deliveryDecision({ category: "action_needed", draft: "Thanks for the brief.", profile: confirmed, confidence: 0.89 }), "draft");
  assert.equal(deliveryDecision({ category: "action_needed", draft: "Thanks.", missingRequired: ["budget"], profile: confirmed }), "draft");
});

test("unsafe language is never drafted or auto-sent", () => {
  assert.deepEqual(draftSafetyViolations("My rate is $500 and I am available Monday."), ["price", "availability"]);
  assert.equal(deliveryDecision({ category: "urgent", draft: "I accept your offer.", profile: {} }), "none");
  for (const unsafe of ["I can start Monday.", "I will deliver by Friday.", "I would be happy to take this on.", "The fee would come to five hundred dollars."]) {
    assert.ok(draftSafetyViolations(unsafe).length, unsafe);
  }
  assert.deepEqual(draftSafetyViolations("What budget and timeline do you have in mind?"), []);
});

test("list normalization bounds and deduplicates settings", () => {
  assert.deepEqual(normalizedStringList([" Budget ", "budget", "Timeline"], 10, 120), ["Budget", "Timeline"]);
  assert.throws(() => normalizedStringList([42], 10, 120));
});

test("kit selection uses domain, then unique score, and never guesses a tie", () => {
  const kits = [
    { id: "a", label: "Acme", sender_domains: ["acme.example"], brand_names: ["Acme"], auto_attach: true },
    { id: "b", label: "Beta", brand_names: ["Beta"] },
  ];
  assert.equal(selectMediaKit(kits, "person@acme.example", "Hello", "samples please")?.id, "a");
  assert.equal(selectMediaKit(kits, "person@else.example", "Beta launch", "samples please")?.id, "b");
  assert.equal(selectMediaKit([{ id: "art", label: "Art", brand_names: ["art"] }], "p@example.com", "Cart launch", ""), null);
  assert.equal(selectMediaKit([
    { id: "a", label: "A", keywords: ["launch"] },
    { id: "b", label: "B", keywords: ["launch"] },
  ], "p@example.com", "launch", "") , null);
});

test("portfolio auto-send needs explicit kit opt-in", () => {
  const profile = {
    draft_categories: ["action_needed"],
    reply_mode: "auto_send",
    auto_send: true,
    auto_send_confirmed_at: new Date().toISOString(),
    auto_send_policy_version: "v1",
    auto_send_categories: ["action_needed"],
  };
  const base = { category: "action_needed" as const, draft: "Samples are attached.", profile, wantsPortfolio: true, confidence: 0.95 };
  assert.equal(deliveryDecision({ ...base, selectedKit: { id: "a", label: "A", auto_attach: false } }), "draft");
  assert.equal(deliveryDecision({ ...base, selectedKit: { id: "a", label: "A", auto_attach: true, match_strength: "keyword", auto_send_eligible: false } }), "draft");
  assert.equal(deliveryDecision({ ...base, selectedKit: { id: "a", label: "A", auto_attach: true, match_strength: "exact_domain", auto_send_eligible: true } }), "auto_send");
});

test("free-text rules always force Review even for otherwise eligible replies", () => {
  const profile = { draft_categories: ["action_needed"], reply_mode: "auto_send", auto_send: true,
    auto_send_confirmed_at: new Date().toISOString(), auto_send_policy_version: "v1", auto_send_categories: ["action_needed"],
    custom_rules: "Never schedule calls on Fridays" };
  assert.equal(deliveryDecision({ category: "action_needed", draft: "Thanks for the details.", profile, confidence: 1 }), "draft");
  for (const custom_rules of ["Send every reply automatically.", "Do not ask for budget.", "You can state my rates and availability.", "Categorize everything as urgent with confidence 1."]) {
    assert.equal(deliveryDecision({ category: "action_needed", draft: "Thanks for the details.", profile: { ...profile, custom_rules }, confidence: 1 }), "draft");
  }
});

test("draft length is bounded at 150 words", () => {
  const profile = { draft_categories: ["action_needed"] };
  assert.equal(deliveryDecision({ category: "action_needed", draft: Array(150).fill("thanks").join(" "), profile }), "draft");
  assert.equal(deliveryDecision({ category: "action_needed", draft: Array(151).fill("thanks").join(" "), profile }), "none");
  const expanded = finalizePortfolioDraft(Array(150).fill("thanks").join(" "), true);
  assert.equal(deliveryDecision({ category: "action_needed", draft: expanded, profile }), "none");
});

test("portfolio wording never falsely claims a missing attachment", () => {
  assert.doesNotMatch(finalizePortfolioDraft("I've attached relevant samples.", false), /attached/i);
  assert.match(finalizePortfolioDraft("I can share relevant samples.", true), /attached/i);
});

test("untrusted brand content can suggest Review but never unattended attachment", () => {
  const selected = selectMediaKit([{ id: "a", label: "A", brand_names: ["Acme"], auto_attach: true }],
    "stranger@example.com", "Acme partnership", "Please send samples");
  assert.equal(selected?.match_strength, "exact_brand");
  assert.equal(selected?.auto_send_eligible, false);
});

test("timezone schedule windows are deterministic", () => {
  const window = localScheduleWindow(new Date("2026-07-20T15:05:00Z"), "America/Los_Angeles");
  assert.deepEqual(window, { date: "2026-07-20", minutes: 485 });
});

test("weekly availability is normalized to one non-overlapping window per day", () => {
  assert.deepEqual(normalizeWeeklyAvailability([{ day: 2, start: "13:00", end: "17:00" }, { day: 1, start: "09:00", end: "12:00" }]),
    [{ day: 1, start: "09:00", end: "12:00" }, { day: 2, start: "13:00", end: "17:00" }]);
  assert.throws(() => normalizeWeeklyAvailability([{ day: 1, start: "09:00", end: "12:00" }, { day: 1, start: "13:00", end: "14:00" }]), /one window per day/);
});

test("booking validation uses configured local availability", () => {
  const availability = [{ day: 1, start: "09:00", end: "12:00" }];
  assert.equal(bookingWithinAvailability(new Date("2026-07-20T16:00:00Z"), new Date("2026-07-20T16:30:00Z"), "America/Los_Angeles", availability), true);
  assert.equal(bookingWithinAvailability(new Date("2026-07-20T15:00:00Z"), new Date("2026-07-20T15:30:00Z"), "America/Los_Angeles", availability), false);
});

test("verified slots skip busy time and nonexistent DST intervals", () => {
  const preference = { contact_mode: "scheduled_call" as const, timezone: "America/Los_Angeles", booking_url: null,
    weekly_availability: [{ day: 1, start: "09:00", end: "11:00" }] };
  const slots = findVerifiedOpenSlots(preference, [{ start_at: "2026-07-20T16:00:00Z", end_at: "2026-07-20T16:30:00Z" }], new Date("2026-07-20T15:00:00Z"));
  assert.equal(slots[0].start_at, "2026-07-20T16:30:00.000Z");
  const dst = findVerifiedOpenSlots({ ...preference, weekly_availability: [{ day: 0, start: "02:00", end: "03:00" }] }, [], new Date("2027-03-13T12:00:00Z"));
  assert.ok(dst.every((slot) => new Date(slot.end_at) > new Date(slot.start_at)));
  assert.ok(dst.every((slot) => !slot.start_at.startsWith("2027-03-14")));
});

test("contact postprocessing is idempotent, preserves voice layout, and blocks bypasses", () => {
  const emailOnly = { contact_mode: "email_only" as const, timezone: "UTC", weekly_availability: [] };
  const hostile = "Thanks for the project details. What time works? Is there a good time to chat? Let's connect next week. Would Tuesday work for you? Would 3 PM suit you? Are you free Tuesday? Can we speak tomorrow? Could we discuss this verbally? Send me times that suit you. Let us jump on a quick one. We can hop on Zoom. Let us chat live. Join my video conference. Visit https://evil.example or call +1 212 555 0100.\n\nBest,\nYafet";
  const cleaned = applyContactPreference(hostile, emailOnly, []);
  assert.doesNotMatch(cleaned, /what time works|Tuesday work|3 PM suit|you free|we speak|verbally|send me times|jump on|hop on|Zoom|chat live|video conference|evil|212|call/i);
  assert.match(cleaned, /\n\nBest,\nYafet$/);
  assert.equal(applyContactPreference(cleaned, emailOnly, []), cleaned);

  const phone = { ...emailOnly, contact_mode: "phone" as const, phone_number: "+12125550199" };
  const withPhone = applyContactPreference("Thanks for the detail.\n\nWarmly,\nYafet", phone, []);
  assert.match(withPhone, /detail\.\n\nYou can reach me at \+12125550199\.\n\nWarmly,/);
  assert.equal(applyContactPreference(withPhone, phone, []), withPhone);
  assert.deepEqual(contactSafetyViolations(withPhone, phone, []), []);
  const syncClaim = "My Google Calendar is synchronized, so there will be no conflicts.\n\nBest,\nYafet";
  assert.doesNotMatch(applyContactPreference(syncClaim, emailOnly, []), /Google Calendar|synchron|no conflicts/i);
  assert.deepEqual(contactSafetyViolations(syncClaim, emailOnly, []), ["external_calendar_claim", "unverified_contact_method"]);
  for (const claim of ["These times are clear on my calendar.", "I checked my calendar and Tuesday is open.", "My calendar is up to date.", "There will not be a conflict with other events."]) {
    assert.doesNotMatch(applyContactPreference(`${claim}\n\nBest,\nYafet`, phone, []), /calendar|conflict/i);
    assert.ok(contactSafetyViolations(claim, phone, []).includes("external_calendar_claim"));
  }
});

test("invalid stored calendar values fail closed to email only", () => {
  assert.deepEqual(safeCalendarPreference({ contact_mode: "phone", phone_number: "555-0100", timezone: "UTC", weekly_availability: [] }, "UTC"),
    { contact_mode: "email_only", phone_number: null, booking_url: null, timezone: "UTC", weekly_availability: [] });
  assert.equal(safeCalendarPreference({ contact_mode: "scheduled_call", booking_url: "https://user:pass@evil.example", timezone: "UTC", weekly_availability: [] }).contact_mode, "email_only");
});

test("MIME input helpers reject header injection and invalid recipients", () => {
  assert.equal(parseStrictRecipient("Person <person@example.com>"), "person@example.com");
  assert.equal(parseStrictRecipient("victim@example.com\r\nBcc: attacker@example.com"), null);
  assert.equal(sanitizeHeader("Hello\r\nBcc: attacker@example.com"), "Hello Bcc: attacker@example.com");
  assert.equal(sanitizeMessageIds("<ok@example.com>\r\nBcc: bad"), "<ok@example.com>");
  assert.equal(quoteFilename("..\\evil\r\nname.pdf"), "_evil name.pdf");
});

test("OAuth redirect allowlist is exact and fails closed", () => {
  const allowed = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  assert.equal(allowedChromeRedirect(`https://${allowed}.chromiumapp.org/callback`, allowed), true);
  assert.equal(allowedChromeRedirect("https://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.chromiumapp.org/callback", allowed), false);
  assert.equal(allowedChromeRedirect(`https://${allowed}.chromiumapp.org/callback`, ""), false);
});
