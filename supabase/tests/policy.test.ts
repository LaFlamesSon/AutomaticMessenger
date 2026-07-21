import assert from "node:assert/strict";
import test from "node:test";
import {
  deliveryDecision,
  draftSafetyViolations,
  finalizePortfolioDraft,
  localScheduleWindow,
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
