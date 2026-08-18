import assert from "node:assert/strict";
import test from "node:test";

import {
  cafActivationStatuses, cafForwardToAlias, gmailCafForwardedAlias, routeProbeClaimToken,
} from "../functions/_shared/inbound-alias.ts";

const TOKEN = "a".repeat(48);
const SUBJECT = `CaughtUp connection check ${TOKEN}`;
const ALIAS = "yafet2132@inbound.getcaughtup.io";

test("Gmail CAF envelope rewrite still claims the route probe token", () => {
  assert.equal(
    gmailCafForwardedAlias("yafet2132+caf_=yafet2132=inbound.getcaughtup.io@gmail.com"),
    ALIAS,
  );
  assert.equal(routeProbeClaimToken({
    subject: SUBJECT,
    from: "other.brand@example.com",
    envelopeFrom: "yafet2132+caf_=yafet2132=inbound.getcaughtup.io@gmail.com",
    aliasAddress: ALIAS,
  }), TOKEN);
});

test("direct probe sender still claims without a CAF envelope", () => {
  assert.equal(routeProbeClaimToken({
    subject: SUBJECT,
    from: "setup-probe@getcaughtup.io",
    envelopeFrom: "setup-probe@getcaughtup.io",
    aliasAddress: ALIAS,
  }), TOKEN);
});

test("CAF mail to a different alias does not claim the token", () => {
  assert.equal(routeProbeClaimToken({
    subject: SUBJECT,
    from: "other.brand@example.com",
    envelopeFrom: "yafet2132+caf_=other=inbound.getcaughtup.io@gmail.com",
    aliasAddress: ALIAS,
  }), null);
});

test("Gmail CAF envelope to this alias is enough to activate the route", () => {
  assert.equal(cafForwardToAlias("yafet2132+caf_=yafet2132=inbound.getcaughtup.io@gmail.com", {
    alias_address: ALIAS,
  }), true);
  assert.equal(cafForwardToAlias("brand@example.com", { alias_address: ALIAS }), false);
  assert.equal(cafForwardToAlias("yafet2132+caf_=other=inbound.getcaughtup.io@gmail.com", {
    alias_address: ALIAS,
  }), false);
  assert.ok(cafActivationStatuses().includes("google_verification_received"));
});
