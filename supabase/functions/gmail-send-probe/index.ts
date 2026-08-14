// The one-time Gmail send acceptance probe is permanently retired. Production
// Gmail sending is connected through gmail-oauth and no probe credentials are
// read by this endpoint.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(() => new Response(JSON.stringify({
  error: "Gmail send probe retired",
  code: "probe_retired",
}), {
  status: 410,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  },
}));
