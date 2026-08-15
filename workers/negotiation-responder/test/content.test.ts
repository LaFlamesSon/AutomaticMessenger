import { describe, expect, it } from "vitest";

import {
  AUTHORIZED_RUN_TAG,
  RESPONDERS,
  buildReplySubject,
  getResponder,
  isAuthorizedThread,
  normalizeAddress,
} from "../src/content";

describe("negotiation responder allowlist", () => {
  it("contains exactly the six authorized test aliases", () => {
    expect(Object.keys(RESPONDERS).sort()).toEqual([
      "cedar-stone@getcaughtup.io",
      "field-notes@getcaughtup.io",
      "harbor-creative@getcaughtup.io",
      "morrow-goods@getcaughtup.io",
      "nova-hydration@getcaughtup.io",
      "solace-beauty@getcaughtup.io",
    ]);
  });

  it("normalizes envelope addresses and rejects unknown aliases", () => {
    expect(normalizeAddress("  Cedar-Stone@GetCaughtUp.io ")).toBe("cedar-stone@getcaughtup.io");
    expect(getResponder(" Cedar-Stone@GetCaughtUp.io ")?.name).toBe("Cedar and Stone");
    expect(getResponder("unknown@getcaughtup.io")).toBeNull();
  });
});
describe("test-thread gate", () => {
  it("accepts only the authorized run tag", () => {
    expect(isAuthorizedThread(`Re: [${AUTHORIZED_RUN_TAG}-04] Billing contact confirmation`)).toBe(true);
    expect(isAuthorizedThread("Re: ordinary production email")).toBe(false);
    expect(isAuthorizedThread("Re: [CUCF20-20260814A-04] old run")).toBe(false);
  });

  it("removes header injection and duplicate reply prefixes", () => {
    expect(buildReplySubject("Re: RE: Topic\r\nBcc: attacker@example.com")).toBe(
      "Re: Topic Bcc: attacker@example.com",
    );
  });
});

describe("fixed response safety", () => {
  it("does not make price, timing, acceptance, or availability commitments", () => {
    const forbidden = /\$|\bprice\b|\brate\b|\bavailable\b|\bavailability\b|\bturnaround\b|\baccept(?:ed|ance)?\b|\breject(?:ed|ion)?\b/i;
    for (const responder of Object.values(RESPONDERS)) {
      expect(responder.body).not.toMatch(forbidden);
    }
  });
});
