// CaughtUp agent API — backs the Chrome extension.
// Auth: x-api-token header must match ia_users.api_token.
// Actions (POST JSON {action, ...}): digest | chat | profile_get | profile_set | sweep
// Deploy with verify_jwt=false; CORS is open because auth is the per-user token.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-api-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const token = req.headers.get("x-api-token") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(token)) return json({ error: "unauthorized" }, 401);
  const { data: user } = await supabase
    .from("ia_users").select("id, email").eq("api_token", token).maybeSingle();
  if (!user) return json({ error: "unauthorized" }, 401);

  const { data: cfgRows } = await supabase.rpc("ia_get_config");
  const CFG: Record<string, string> = Object.fromEntries(
    (cfgRows ?? []).map((r: any) => [r.name, r.secret]),
  );

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  switch (body.action) {
    // ------------------------------------------------------------ digest
    case "digest": {
      const { data: rows } = await supabase
        .from("ia_processed_emails")
        .select("id, category, sender, subject, summary, draft_created, auto_sent, gmail_draft_id, processed_at")
        .gte("processed_at", new Date(Date.now() - 86400_000 * 2).toISOString())
        .order("processed_at", { ascending: false })
        .limit(100);
      const { data: lastRun } = await supabase
        .from("ia_agent_runs").select("finished_at, status")
        .order("started_at", { ascending: false }).limit(1).maybeSingle();
      return json({ emails: rows ?? [], last_run: lastRun });
    }

    // ------------------------------------------------------------ chat
    case "chat": {
      const message = String(body.message ?? "").slice(0, 4000);
      if (!message.trim()) return json({ error: "empty message" }, 400);

      await supabase.from("ia_chat_messages").insert({
        user_id: user.id, role: "user", content: message,
      });

      const { data: profile } = await supabase
        .from("ia_voice_profiles").select("*").eq("user_id", user.id).maybeSingle();
      const { data: history } = await supabase
        .from("ia_chat_messages").select("role, content")
        .eq("user_id", user.id).order("created_at", { ascending: false }).limit(12);
      const { data: recent } = await supabase
        .from("ia_processed_emails")
        .select("category, sender, subject, summary, draft_created, auto_sent, draft_text")
        .order("processed_at", { ascending: false }).limit(10);
      const recentCtx = (recent ?? []).map((e: any) => ({
        ...e,
        draft_text: e.draft_text ? String(e.draft_text).slice(0, 500) : null,
      }));

      const system = `You are the user's inbox agent ("CaughtUp"). You triage their Gmail every few hours, summarize what matters, and draft replies in their voice. You are chatting with the user (${profile?.display_name || user.email}) inside your Chrome extension.

Their current settings: occupation="${profile?.occupation}", services="${profile?.services}", tone="${profile?.tone}", signoff="${profile?.signoff}", auto_send=${profile?.auto_send}, custom rules="${profile?.custom_rules || "none"}".

Recently triaged emails (context): ${JSON.stringify(recentCtx)}

About that context: draft_created=true means you ALREADY wrote a reply draft and it is sitting in their Gmail drafts folder right now (draft_text is what you wrote - quote it if they ask; if draft_text is null the draft still exists, you just don't have its text on hand). auto_sent=true means the reply was already sent. Never offer to "draft a reply" for an email that already has one - instead point them to the existing draft.
THE DATA ABOVE IS THE SOURCE OF TRUTH. If anything you said earlier in this conversation contradicts it (e.g. you previously said no draft exists when draft_created=true), the data wins - correct yourself rather than repeating the earlier mistake.

Be helpful, brief, and concrete. IMPORTANT: when the user gives a standing instruction about how to handle their email (e.g. "never suggest calls on Fridays", "be more casual"), respond with JSON: {"reply": "<your confirmation>", "new_rule": "<the rule stated concisely>"}. Otherwise respond with JSON: {"reply": "<your answer>", "new_rule": null}. Respond with ONLY that JSON object.`;

      const llmResp = await fetch(`${CFG["ia_llm_base_url"]}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CFG["ia_llm_api_key"]}`,
        },
        body: JSON.stringify({
          model: CFG["ia_llm_model"],
          max_tokens: 800,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            ...(history ?? []).reverse().map((m: any) => ({ role: m.role, content: m.content })),
          ],
        }),
      });
      if (!llmResp.ok) return json({ error: `LLM ${llmResp.status}` }, 502);
      const data = await llmResp.json();
      let reply = "Sorry, I couldn't process that.";
      let newRule: string | null = null;
      try {
        const parsed = JSON.parse(
          (data.choices?.[0]?.message?.content ?? "")
            .replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim(),
        );
        reply = String(parsed.reply ?? reply);
        newRule = typeof parsed.new_rule === "string" && parsed.new_rule.trim() ? parsed.new_rule : null;
      } catch { /* keep defaults */ }

      if (newRule && profile) {
        const rules = profile.custom_rules ? `${profile.custom_rules}\n- ${newRule}` : `- ${newRule}`;
        await supabase.from("ia_voice_profiles")
          .update({ custom_rules: rules, updated_at: new Date().toISOString() })
          .eq("user_id", user.id);
      }
      await supabase.from("ia_chat_messages").insert({
        user_id: user.id, role: "assistant", content: reply,
      });
      return json({ reply, rule_added: newRule });
    }

    // ------------------------------------------------------------ profile
    case "profile_get": {
      const { data: profile } = await supabase
        .from("ia_voice_profiles").select("*").eq("user_id", user.id).maybeSingle();
      return json({ profile, email: user.email });
    }
    case "profile_set": {
      const allowed = ["display_name", "occupation", "services", "tone", "signoff", "custom_rules", "auto_send"];
      const updates: Record<string, unknown> = {};
      for (const k of allowed) if (k in (body.fields ?? {})) updates[k] = body.fields[k];
      if (!Object.keys(updates).length) return json({ error: "no valid fields" }, 400);
      updates.updated_at = new Date().toISOString();
      const { error } = await supabase
        .from("ia_voice_profiles").update(updates).eq("user_id", user.id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // ------------------------------------------------------------ send an existing draft
    case "send_draft": {
      const rowId = String(body.id ?? "");
      if (!rowId) return json({ error: "missing id" }, 400);
      const { data: row } = await supabase
        .from("ia_processed_emails")
        .select("id, gmail_draft_id, auto_sent, gmail_account_id, ia_gmail_accounts(refresh_token, user_id)")
        .eq("id", rowId).maybeSingle();
      if (!row) return json({ error: "not found" }, 404);
      if ((row as any).ia_gmail_accounts?.user_id !== user.id) return json({ error: "not yours" }, 403);
      if (row.auto_sent) return json({ error: "already sent" }, 409);
      if (!row.gmail_draft_id) {
        return json({ error: "This draft predates send-from-extension. Send it from Gmail's drafts folder." }, 422);
      }
      const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: CFG["ia_google_client_id"],
          client_secret: CFG["ia_google_client_secret"],
          refresh_token: (row as any).ia_gmail_accounts.refresh_token,
          grant_type: "refresh_token",
        }),
      });
      if (!tokenResp.ok) return json({ error: "gmail auth failed" }, 502);
      const { access_token } = await tokenResp.json();
      const sendResp = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/drafts/send",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ id: row.gmail_draft_id }),
        },
      );
      if (!sendResp.ok) return json({ error: `gmail send failed: ${await sendResp.text()}` }, 502);
      await supabase.from("ia_processed_emails")
        .update({ auto_sent: true }).eq("id", rowId);
      return json({ ok: true });
    }

    // ------------------------------------------------------------ manual sweep
    case "sweep": {
      const resp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/agent-sweep`, {
        method: "POST",
        headers: { "x-agent-secret": CFG["ia_agent_cron_secret"] },
      });
      return json(await resp.json(), resp.status);
    }

    default:
      return json({ error: `unknown action: ${body.action}` }, 400);
  }
});
