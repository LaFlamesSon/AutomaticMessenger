// Retired after CaughtUp moved inbound mail to user-configured forwarding.
// This endpoint intentionally performs no Gmail, database, or provider work.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-agent-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  return new Response(JSON.stringify({
    error: "Gmail inbox sweeps are retired; forwarded email is processed as it arrives.",
    code: "inbox_sweep_retired",
  }), {
    status: 410,
    headers: { "Content-Type": "application/json", ...CORS },
  });
});
