import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("subscription records and Stripe event claims are service-role-only", async () => {
  const migration = await read("migrations/20260829203214_subscription_foundation.sql");
  for (const table of ["ia_subscriptions", "ia_stripe_events", "ia_billing_notifications"]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migration, /user_id uuid not null references public\.ia_users\(id\) on delete cascade/);
  assert.match(migration, /revoke all on table public\.ia_subscriptions,[\s\S]+from public, anon, authenticated/);
  assert.match(migration, /grant all on table public\.ia_subscriptions,[\s\S]+to service_role/);
  assert.match(migration, /create or replace function public\.ia_claim_stripe_event/);
  assert.match(migration, /create or replace function public\.ia_record_subscription_invoice/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /revoke all on function public\.ia_claim_stripe_event[\s\S]+from public, anon, authenticated/);
});

test("billing API is authenticated, server-priced, disabled by default, and uses hosted Stripe surfaces", async () => {
  const api = await read("functions/agent-api/index.ts");
  const billingCases = api.match(/case "billing_status": \{[\s\S]*?\n      case "profile_get"/)?.[0] ?? "";
  for (const action of ["billing_status", "billing_checkout_create", "billing_portal_create"]) {
    assert.match(api, new RegExp(`case "${action}"`));
  }
  assert.match(api, /ia_billing_checkout_enabled/);
  assert.match(api, /ia_stripe_price_pro_monthly/);
  assert.match(api, /ia_stripe_secret_key/);
  assert.match(api, /sk_live_/);
  assert.match(api, /sk_test_/);
  assert.match(api, /ia_stripe_webhook_secret/);
  assert.match(api, /mode", "subscription"/);
  assert.match(api, /client_reference_id", user\.id/);
  assert.match(api, /subscription_data\[metadata\]\[caughtup_user_id\]/);
  assert.match(api, /billing_portal\/sessions/);
  assert.match(api, /Idempotency-Key/);
  assert.match(api, /checkoutStillOpen/);
  assert.match(api, /params\.set\("expires_at"/);
  assert.doesNotMatch(billingCases, /body\.(?:price|price_id|customer|customer_id)/);
});

test("Stripe webhook verifies raw signatures, deduplicates events, and handles lifecycle events", async () => {
  const [webhook, stripe] = await Promise.all([
    read("functions/stripe-webhook/index.ts"),
    read("functions/_shared/stripe.ts"),
  ]);
  assert.match(webhook, /await req\.text\(\)/);
  assert.match(webhook, /verifyStripeSignature/);
  assert.match(webhook, /ia_claim_stripe_event/);
  assert.match(webhook, /ia_stripe_events/);
  for (const event of [
    "checkout.session.completed", "customer.subscription.created", "customer.subscription.updated",
    "customer.subscription.deleted", "customer.subscription.paused", "customer.subscription.resumed",
    "invoice.paid", "invoice.payment_failed", "invoice.payment_action_required",
    "customer.subscription.trial_will_end", "invoice.upcoming",
  ]) assert.match(webhook, new RegExp(event.replaceAll(".", "\\.")));
  assert.match(stripe, /constantTimeEqual/);
  assert.match(stripe, /signatures: string\[\]/);
  assert.match(stripe, /STRIPE_SIGNATURE_TOLERANCE_SECONDS/);
  assert.match(webhook, /return "orphaned"/);
  assert.match(webhook, /ia_record_subscription_invoice/);
  const paidCase = webhook.match(/if \(event\.type === "invoice\.paid"\)[\s\S]*?return "applied";/)?.[0] ?? "";
  assert.doesNotMatch(paidCase, /applySubscriptionState/);
});

test("verified account deletion cancels an owned Stripe subscription before removing user data", async () => {
  const api = await read("functions/agent-api/index.ts");
  const deletion = api.match(/case "caughtup_data_delete": \{([\s\S]*?)\n      case "learning_reset"/)?.[1] ?? "";
  assert.match(deletion, /from\("ia_subscriptions"\)/);
  assert.match(deletion, /cancelStripeSubscription\(CFG, subscriptionId\)/);
  assert.ok(deletion.indexOf("cancelStripeSubscription(CFG, subscriptionId)") < deletion.indexOf("auth.admin.deleteUser"));
  assert.match(api, /method: "DELETE"/);
});

test("extension exposes honest subscription status and a direct manage-billing path", async () => {
  const [html, script] = await Promise.all([
    read("../extension/popup.html"),
    read("../extension/popup.js"),
  ]);
  for (const id of ["billingCard", "billingStatus", "startSubscription", "manageBilling"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(script, /billing_status/);
  assert.match(script, /billing_checkout_create/);
  assert.match(script, /billing_portal_create/);
  assert.match(script, /crypto\.randomUUID\(\)/);
  assert.match(html, /Paid subscriptions are not available until CaughtUp explicitly opens enrollment/);
});

test("public policies disclose Stripe, recurring billing, cancellation, and renewal reminders", async () => {
  const [privacy, terms, support] = await Promise.all([
    read("../web/privacy/index.html"),
    read("../web/terms/index.html"),
    read("../web/support/index.html"),
  ]);
  assert.match(privacy, /Stripe/);
  assert.match(privacy, /payment and subscription metadata/);
  assert.match(terms, /Recurring subscriptions/);
  assert.match(terms, /Manage billing/);
  assert.match(terms, /renewal reminder/i);
  assert.match(support, /cancel.*Manage billing/i);
});

test("general chat has a deterministic crisis-safety boundary before the model call", async () => {
  const [api, policy] = await Promise.all([
    read("functions/agent-api/index.ts"),
    read("functions/_shared/policy.ts"),
  ]);
  const chat = api.match(/case "chat": \{([\s\S]*?)\n      case "profile_get"/)?.[1] ?? "";
  assert.match(policy, /export function crisisSafetyResponse/);
  assert.match(chat, /crisisSafetyResponse\(message\)/);
  assert.ok(chat.indexOf("crisisSafetyResponse(message)") < chat.indexOf("ia_llm_base_url"));
  assert.match(chat, /role: "assistant", content: crisisReply/);
});
