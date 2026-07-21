// Retired development seeder.
//
// Media kits are now uploaded by their authenticated owner through agent-api.
// Keeping this endpoint inert prevents the legacy implementation from selecting
// an arbitrary first user or downloading mutable remote fixture files.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(() => new Response(
  JSON.stringify({ error: "seed-media-kit is retired; upload through the Kits tab" }),
  {
    status: 410,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  },
));
