// One-shot seeder: fetches sample media-kit files from the public GitHub repo
// and uploads them into the private media-kit storage bucket.
// Auth: x-agent-secret must match the ia_agent_cron_secret vault secret.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const BASE = "https://raw.githubusercontent.com/LaFlamesSon/AutomaticMessenger/main/assets/media-kit";
const FILES = [
  { name: "Yafet-Media-Kit.pdf", mime: "application/pdf" },
  { name: "logo-work-samples.png", mime: "image/png" },
];

Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: cfgRows } = await supabase.rpc("ia_get_config");
  const CFG: Record<string, string> = Object.fromEntries(
    (cfgRows ?? []).map((r: any) => [r.name, r.secret]),
  );
  if (!CFG["ia_agent_cron_secret"] || req.headers.get("x-agent-secret") !== CFG["ia_agent_cron_secret"]) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  // Files are stored per-user: media-kit/{user_id}/<file>
  const { data: firstUser } = await supabase.from("ia_users").select("id").limit(1).single();
  if (!firstUser) return new Response(JSON.stringify({ error: "no users" }), { status: 400 });
  // Clean up any legacy root-level copies
  await supabase.storage.from("media-kit").remove(FILES.map((f) => f.name));

  const results: any[] = [];
  for (const f of FILES) {
    try {
      const resp = await fetch(`${BASE}/${f.name}`);
      if (!resp.ok) throw new Error(`fetch ${f.name}: ${resp.status}`);
      const bytes = new Uint8Array(await resp.arrayBuffer());
      const { error } = await supabase.storage
        .from("media-kit")
        .upload(`${firstUser.id}/${f.name}`, bytes, { contentType: f.mime, upsert: true });
      if (error) throw new Error(error.message);
      results.push({ file: f.name, bytes: bytes.length, ok: true });
    } catch (err) {
      results.push({ file: f.name, ok: false, error: String(err) });
    }
  }
  return new Response(JSON.stringify({ results }), {
    headers: { "Content-Type": "application/json" },
  });
});
