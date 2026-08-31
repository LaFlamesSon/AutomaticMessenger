// Stripe subscription lifecycle webhook. Billing remains inert until the
// required ia_stripe_* Vault configuration is explicitly installed.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  normalizedSubscriptionStatus,
  stripeIdentifier,
  stripeUnixTimestamp,
  subscriptionHasAccess,
  verifyStripeSignature,
} from "../_shared/stripe.ts";

const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "customer.subscription.trial_will_end",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "invoice.upcoming",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function eventTimestamp(event: any): string {
  return stripeUnixTimestamp(event.created) ?? new Date().toISOString();
}

function objectId(object: any): string | null {
  return typeof object?.id === "string" && object.id.length <= 300 ? object.id : null;
}

function userMetadataId(object: any): string | null {
  const candidate = object?.client_reference_id ?? object?.metadata?.caughtup_user_id ??
    object?.subscription_details?.metadata?.caughtup_user_id;
  return typeof candidate === "string" && UUID.test(candidate) ? candidate : null;
}

function customerId(object: any): string | null {
  const value = typeof object?.customer === "string" ? object.customer : object?.customer?.id;
  return stripeIdentifier(value, "cus");
}

function subscriptionId(object: any): string | null {
  const value = typeof object?.subscription === "string" ? object.subscription :
    object?.object === "subscription" ? object?.id : object?.subscription?.id;
  return stripeIdentifier(value, "sub");
}

function subscriptionPriceId(object: any): string | null {
  const item = object?.items?.data?.[0] ?? object?.lines?.data?.[0];
  const value = item?.price?.id ?? item?.pricing?.price_details?.price;
  return stripeIdentifier(value, "price");
}

function periodTimestamp(object: any, field: "current_period_start" | "current_period_end"): string | null {
  const item = object?.items?.data?.[0];
  return stripeUnixTimestamp(object?.[field] ?? item?.[field]);
}

async function resolveUserId(supabase: any, object: any): Promise<string | null> {
  const metadataId = userMetadataId(object);
  const customer = customerId(object);
  const subscription = subscriptionId(object);
  const { data: linked, error: linkError } = customer || subscription
    ? await supabase.from("ia_subscriptions").select("user_id,stripe_customer_id,stripe_subscription_id")
      .or([
        customer ? `stripe_customer_id.eq.${customer}` : "",
        subscription ? `stripe_subscription_id.eq.${subscription}` : "",
      ].filter(Boolean).join(",")).limit(1).maybeSingle()
    : { data: null, error: null };
  if (linkError) throw new Error("subscription_lookup_failed");
  if (linked && metadataId && linked.user_id !== metadataId) throw new Error("subscription_owner_conflict");
  const userId = linked?.user_id ?? metadataId;
  if (!userId) return null;
  const { data: user, error: userError } = await supabase.from("ia_users").select("id,stripe_customer_id")
    .eq("id", userId).maybeSingle();
  if (userError) throw new Error("billing_user_lookup_failed");
  if (!user) return null;
  if (customer && user.stripe_customer_id && user.stripe_customer_id !== customer) {
    throw new Error("stripe_customer_conflict");
  }
  return user.id;
}

async function applySubscriptionState(
  supabase: any,
  event: any,
  object: any,
  userId: string,
  status: string,
  entitled: boolean,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await supabase.rpc("ia_apply_subscription_state", {
    p_user_id: userId,
    p_customer_id: customerId(object),
    p_subscription_id: subscriptionId(object),
    p_price_id: subscriptionPriceId(object),
    p_status: status,
    p_cancel_at_period_end: object?.cancel_at_period_end === true,
    p_current_period_start: periodTimestamp(object, "current_period_start"),
    p_current_period_end: periodTimestamp(object, "current_period_end"),
    p_trial_end: stripeUnixTimestamp(object?.trial_end),
    p_canceled_at: stripeUnixTimestamp(object?.canceled_at),
    p_ended_at: stripeUnixTimestamp(object?.ended_at),
    p_last_invoice_id: stripeIdentifier(object?.latest_invoice ?? object?.id, "in"),
    p_last_payment_at: overrides.last_payment_at ?? null,
    p_event_created_at: eventTimestamp(event),
    p_entitled: entitled,
    ...overrides,
  });
  if (error) throw new Error("subscription_state_failed");
}

async function queueNotification(
  supabase: any,
  eventId: string,
  userId: string,
  kind: "trial_ending" | "renewal_upcoming" | "payment_failed" | "payment_action_required" | "subscription_canceled",
  dueAt: string | null,
): Promise<void> {
  const { error } = await supabase.from("ia_billing_notifications").upsert({
    user_id: userId,
    stripe_event_id: eventId,
    kind,
    due_at: dueAt,
  }, { onConflict: "stripe_event_id,kind", ignoreDuplicates: true });
  if (error) throw new Error("billing_notification_failed");
}

async function recordInvoice(
  supabase: any,
  event: any,
  object: any,
  userId: string,
  paid: boolean,
): Promise<void> {
  const invoiceId = stripeIdentifier(object?.id, "in");
  if (!invoiceId) throw new Error("billing_invoice_invalid");
  const { error } = await supabase.rpc("ia_record_subscription_invoice", {
    p_user_id: userId,
    p_invoice_id: invoiceId,
    p_paid_at: paid ? eventTimestamp(event) : null,
    p_event_created_at: eventTimestamp(event),
  });
  if (error) throw new Error("billing_invoice_update_failed");
}

async function processEvent(supabase: any, event: any): Promise<"applied" | "orphaned"> {
  const object = event.data.object;
  const userId = await resolveUserId(supabase, object);
  // Signed events can arrive after verified account deletion removed the local
  // owner mapping. Acknowledge them without recreating or retrying user data.
  if (!userId) return "orphaned";

  if (event.type === "checkout.session.completed") {
    await applySubscriptionState(supabase, event, object, userId, "checkout_pending", false);
    return "applied";
  }

  if (event.type.startsWith("customer.subscription.")) {
    const deleted = event.type === "customer.subscription.deleted";
    const status = deleted ? "canceled" : normalizedSubscriptionStatus(object.status);
    await applySubscriptionState(supabase, event, object, userId, status, !deleted && subscriptionHasAccess(status));
    if (deleted) await queueNotification(supabase, event.id, userId, "subscription_canceled", eventTimestamp(event));
    if (event.type === "customer.subscription.trial_will_end") {
      await queueNotification(supabase, event.id, userId, "trial_ending", stripeUnixTimestamp(object.trial_end));
    }
    return "applied";
  }

  if (event.type === "invoice.paid") {
    // Payment facts do not independently grant access. Stripe's subscription
    // lifecycle event is the authoritative source of subscription status.
    await recordInvoice(supabase, event, object, userId, true);
    return "applied";
  }

  if (event.type === "invoice.payment_failed") {
    await recordInvoice(supabase, event, object, userId, false);
    await queueNotification(supabase, event.id, userId, "payment_failed", eventTimestamp(event));
    return "applied";
  }

  if (event.type === "invoice.payment_action_required") {
    await recordInvoice(supabase, event, object, userId, false);
    await queueNotification(supabase, event.id, userId, "payment_action_required", eventTimestamp(event));
    return "applied";
  }

  if (event.type === "invoice.upcoming") {
    await queueNotification(
      supabase,
      event.id,
      userId,
      "renewal_upcoming",
      stripeUnixTimestamp(object.next_payment_attempt ?? object.period_end),
    );
  }
  return "applied";
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: cfgRows, error: cfgError } = await supabase.rpc("ia_get_config");
  if (cfgError) return json({ error: "configuration unavailable" }, 503);
  const cfg: Record<string, string> = Object.fromEntries(
    (cfgRows ?? []).map((row: any) => [row.name, row.secret]),
  );
  const secret = cfg["ia_stripe_webhook_secret"];
  const configuredLivemode = cfg["ia_stripe_livemode"];
  if (!secret || !["true", "false"].includes(configuredLivemode)) {
    return json({ error: "billing not configured" }, 503);
  }

  const payload = await req.text();
  const signature = req.headers.get("stripe-signature") ?? "";
  if (!(await verifyStripeSignature(payload, signature, secret))) {
    return json({ error: "bad signature" }, 400);
  }

  let event: any;
  try {
    event = JSON.parse(payload);
  } catch {
    return json({ error: "invalid payload" }, 400);
  }
  if (!stripeIdentifier(event?.id, "evt") || typeof event?.type !== "string" ||
      typeof event?.livemode !== "boolean" || !event?.data?.object) {
    return json({ error: "invalid event" }, 400);
  }
  if (event.livemode !== (configuredLivemode === "true")) return json({ error: "billing mode mismatch" }, 400);
  if (!HANDLED_EVENTS.has(event.type)) return json({ received: true, ignored: true });

  const { data: claimed, error: claimError } = await supabase.rpc("ia_claim_stripe_event", {
    p_event_id: event.id,
    p_event_type: event.type,
    p_object_id: objectId(event.data.object),
    p_livemode: event.livemode,
    p_provider_created_at: eventTimestamp(event),
  });
  if (claimError) return json({ error: "event claim failed" }, 500);
  if (claimed !== true) return json({ received: true, duplicate: true });

  try {
    const outcome = await processEvent(supabase, event);
    const { error: finishError } = await supabase.from("ia_stripe_events").update({
      status: "processed",
      processed_at: new Date().toISOString(),
      error_code: outcome === "orphaned" ? "billing_user_not_found" : null,
      updated_at: new Date().toISOString(),
    }).eq("event_id", event.id).eq("status", "processing");
    if (finishError) throw new Error("event_finish_failed");
    return json({ received: true });
  } catch (error) {
    const errorCode = error instanceof Error && /^[a-z0-9_]{3,80}$/.test(error.message)
      ? error.message
      : "event_processing_failed";
    await supabase.from("ia_stripe_events").update({
      status: "failed",
      error_code: errorCode,
      updated_at: new Date().toISOString(),
    }).eq("event_id", event.id).eq("status", "processing");
    console.error(JSON.stringify({ event_id: event.id, event_type: event.type, error_code: errorCode }));
    return json({ error: "event processing failed" }, 500);
  }
});
