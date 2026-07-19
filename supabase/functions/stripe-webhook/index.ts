// Stripe webhook: activates billing when a Stripe account is connected.
// Setup: create a Stripe webhook endpoint pointing here, then store its
// signing secret in the vault as ia_stripe_webhook_secret.
// Handles: checkout.session.completed -> plan=pro (uses client_reference_id
// = ia_users.id set on the Checkout link), customer.subscription.deleted -> plan=free.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

async function verifyStripeSignature(payload: string, sigHeader: string, secret: string): Promise<boolean> {
  const parts: Record<string, string> = {};
  for (const p of sigHeader.split(",")) {
    const [k, v] = p.split("=");
    if (k && v) parts[k.trim()] = v.trim();
  }
  const t = parts["t"], v1 = parts["v1"];
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false; // 5 min tolerance
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === v1;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: cfgRows } = await supabase.rpc("ia_get_config");
  const CFG: Record<string, string> = Object.fromEntries(
    (cfgRows ?? []).map((r: any) => [r.name, r.secret]),
  );

  const secret = CFG["ia_stripe_webhook_secret"];
  if (!secret) return new Response("billing not configured", { status: 503 });

  const payload = await req.text();
  const sig = req.headers.get("stripe-signature") ?? "";
  if (!(await verifyStripeSignature(payload, sig, secret))) {
    return new Response("bad signature", { status: 400 });
  }

  const event = JSON.parse(payload);
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const userId = session.client_reference_id;
      if (userId) {
        await supabase.from("ia_users").update({
          plan: "pro",
          stripe_customer_id: session.customer ?? null,
        }).eq("id", userId);
      }
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      if (sub.customer) {
        await supabase.from("ia_users").update({ plan: "free" })
          .eq("stripe_customer_id", sub.customer);
      }
      break;
    }
    default:
      break; // ignore other events
  }
  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
