import assert from "node:assert/strict";
import test from "node:test";
import {
  parseStripeSignature,
  stripeIdentifier,
  stripeHostedUrl,
  stripeSignature,
  stripeUnixTimestamp,
  subscriptionHasAccess,
  verifyStripeSignature,
} from "../functions/_shared/stripe.ts";

test("Stripe signatures accept any valid v1 signature and enforce recency", async () => {
  const payload = JSON.stringify({ id: "evt_example", type: "invoice.paid" });
  const secret = "whsec_test_only";
  const now = 1_788_035_200;
  const signature = await stripeSignature(payload, now, secret);
  const header = `t=${now},v1=${"0".repeat(64)},v1=${signature}`;
  assert.equal(await verifyStripeSignature(payload, header, secret, now), true);
  assert.equal(await verifyStripeSignature(`${payload} `, header, secret, now), false);
  assert.equal(await verifyStripeSignature(payload, header, secret, now + 301), false);
});

test("Stripe signature parsing rejects malformed headers", () => {
  assert.equal(parseStripeSignature(""), null);
  assert.equal(parseStripeSignature("t=abc,v1=nope"), null);
  assert.equal(parseStripeSignature(`t=123,v1=${"a".repeat(64)}`)?.signatures.length, 1);
});

test("billing helpers keep access and redirects narrowly scoped", () => {
  assert.equal(subscriptionHasAccess("active"), true);
  assert.equal(subscriptionHasAccess("trialing"), true);
  assert.equal(subscriptionHasAccess("past_due"), false);
  assert.equal(stripeHostedUrl("https://checkout.stripe.com/c/pay/cs_test", "checkout.stripe.com")?.startsWith("https://"), true);
  assert.equal(stripeHostedUrl("https://evil.example/", "checkout.stripe.com"), null);
  assert.equal(stripeUnixTimestamp(1_788_035_200), "2026-08-29T20:26:40.000Z");
  assert.equal(stripeUnixTimestamp(0), null);
  assert.equal(stripeIdentifier("cs_test_valid123", "cs"), "cs_test_valid123");
  assert.equal(stripeIdentifier("cs-test-invalid", "cs"), null);
});
