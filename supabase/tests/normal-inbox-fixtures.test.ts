import { assertEquals } from "jsr:@std/assert@1";
import { draftSafetyViolations } from "../functions/_shared/policy.ts";
import { extractCommercialTerms } from "../functions/_shared/negotiations.ts";
import { NORMAL_INBOX_TEST_FIXTURES, NORMAL_INBOX_TEST_REPLY } from "../functions/_shared/test-fixtures.ts";

Deno.test("ordinary inbox harness contains ten non-commercial first-contact messages", () => {
  assertEquals(NORMAL_INBOX_TEST_FIXTURES.length, 10);
  for (const fixture of NORMAL_INBOX_TEST_FIXTURES) {
    assertEquals(extractCommercialTerms(fixture.subject, fixture.body).detected, false, fixture.body);
  }
});

Deno.test("ordinary inbox harness reply remains bounded and negotiation-safe", () => {
  assertEquals(draftSafetyViolations(NORMAL_INBOX_TEST_REPLY), []);
  assertEquals((NORMAL_INBOX_TEST_REPLY.match(/\S+/g) ?? []).length <= 150, true);
});
