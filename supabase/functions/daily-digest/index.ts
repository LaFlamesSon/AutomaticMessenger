// Daily digest: emails each user a morning summary of the last 24 hours.
// Triggered by pg_cron; auth via x-agent-secret matching ia_agent_cron_secret.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { localScheduleWindow } from "../_shared/policy.ts";

let CFG: Record<string, string> = {};

function b64urlEncode(s: string): string {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CFG["ia_google_client_id"],
      client_secret: CFG["ia_google_client_secret"],
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!resp.ok) throw new Error(`token_refresh_${resp.status}`);
  return (await resp.json()).access_token;
}

const CAT_LABELS: Record<string, string> = {
  urgent: "⚡ URGENT",
  action_needed: "✋ ACTION NEEDED",
  fyi: "📋 FYI",
};

Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: cfgRows } = await supabase.rpc("ia_get_config");
  CFG = Object.fromEntries((cfgRows ?? []).map((r: any) => [r.name, r.secret]));

  if (!CFG["ia_agent_cron_secret"] || req.headers.get("x-agent-secret") !== CFG["ia_agent_cron_secret"]) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const { data: accounts, error: accountsError } = await supabase.from("ia_gmail_accounts").select("*");
  if (accountsError) {
    return new Response(JSON.stringify({ error: "account query failed" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
  const results: any[] = [];

  for (const account of accounts ?? []) {
    let jobClaimId: string | null = null;
    let digestSendStarted = false;
    try {
      const { data: profile, error: profileError } = await supabase.from("ia_voice_profiles")
        .select("digest_enabled, digest_local_time, timezone, last_digest_at")
        .eq("user_id", account.user_id).maybeSingle();
      if (profileError) throw new Error(`profile: ${profileError.message}`);
      if (profile?.digest_enabled === false) {
        results.push({ account: account.gmail_address, sent: false, reason: "digest disabled" });
        continue;
      }
      const timezone = profile?.timezone ?? "America/Los_Angeles";
      const local = localScheduleWindow(new Date(), timezone);
      const [hour, minute] = String(profile?.digest_local_time ?? "08:00").slice(0, 5).split(":").map(Number);
      const targetMinutes = hour * 60 + minute;
      const lastLocalDate = profile?.last_digest_at
        ? localScheduleWindow(new Date(profile.last_digest_at), timezone).date
        : null;
      if (local.minutes < targetMinutes || lastLocalDate === local.date) {
        results.push({ account: account.gmail_address, sent: false, reason: "not due" });
        continue;
      }
      const since = new Date(Date.now() - 86400_000).toISOString();
      const { data: rows } = await supabase
        .from("ia_processed_emails")
        .select("category, sender, subject, summary, draft_created, auto_sent")
        .eq("gmail_account_id", account.id)
        .gte("processed_at", since)
        .order("processed_at", { ascending: false });

      if (!rows?.length) {
        results.push({ account: account.gmail_address, sent: false, reason: "nothing to report" });
        continue;
      }

      const { data: claim, error: claimError } = await supabase.rpc("ia_claim_job", {
        p_gmail_account_id: account.id, p_job_type: "digest", p_window_key: local.date,
      });
      if (claimError || !claim) {
        results.push({ account: account.gmail_address, sent: false, reason: "already claimed" });
        continue;
      }
      jobClaimId = claim;

      const byCat: Record<string, any[]> = {};
      for (const r of rows) (byCat[r.category] ??= []).push(r);
      const needsYou = (byCat.urgent?.length ?? 0) + (byCat.action_needed?.length ?? 0);
      const handled = rows.length - needsYou;

      const lines: string[] = [
        `Good morning! Here's what your inbox agent did in the last 24 hours.`,
        ``,
        `${needsYou} need you · ${handled} handled for you`,
        ``,
      ];
      for (const cat of ["urgent", "action_needed", "fyi"]) {
        const items = byCat[cat];
        if (!items?.length) continue;
        lines.push(CAT_LABELS[cat]);
        for (const e of items) {
          const status = e.auto_sent ? " [reply sent]" : e.draft_created ? " [draft ready]" : "";
          lines.push(`  • ${e.sender.replace(/<.*>/, "").trim()} — ${e.subject}${status}`);
          lines.push(`    ${e.summary}`);
        }
        lines.push("");
      }
      const noise = (byCat.low_priority?.length ?? 0) + (byCat.spam_or_poor_fit?.length ?? 0);
      if (noise) lines.push(`🗑 ${noise} newsletters & pitches filtered out for you.`);
      lines.push("", "— CaughtUp, your inbox agent");

      const subject = needsYou
        ? `⚡ ${needsYou} need you, ${handled} handled — your CaughtUp digest`
        : `🎉 All caught up — ${handled} handled for you`;

      const token = await refreshAccessToken(account.refresh_token);
      const raw = b64urlEncode([
        `To: ${account.gmail_address}`,
        `Subject: ${subject}`,
        `Content-Type: text/plain; charset="UTF-8"`,
        "",
        lines.join("\r\n"),
      ].join("\r\n"));
      const { data: sendingClaim, error: sendingClaimError } = await supabase.from("ia_job_claims")
        .update({ status: "sending" }).eq("id", claim).eq("status", "claimed")
        .select("id").maybeSingle();
      if (sendingClaimError || !sendingClaim) throw new Error("digest_send_claim_failed");
      digestSendStarted = true;
      const send = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ raw }),
        },
      );
      if (!send.ok) throw new Error(`gmail_send_${send.status}`);
      const finishedAt = new Date().toISOString();
      const { data: sentClaim, error: sentClaimError } = await supabase.from("ia_job_claims")
        .update({ status: "sent", finished_at: finishedAt }).eq("id", claim).eq("status", "sending")
        .select("id").maybeSingle();
      if (sentClaimError || !sentClaim) throw new Error("digest_send_state_failed");
      const { error: profileUpdateError } = await supabase.from("ia_voice_profiles")
        .update({ last_digest_at: finishedAt, updated_at: finishedAt }).eq("user_id", account.user_id);
      if (profileUpdateError) throw new Error(`digest state: ${profileUpdateError.message}`);
      const { error: completeError } = await supabase.from("ia_job_claims")
        .update({ status: "ok", finished_at: finishedAt }).eq("id", claim).eq("status", "sent");
      if (completeError) throw new Error("digest_completion_failed");
      results.push({ account: account.gmail_address, sent: true, needsYou, handled });
    } catch (err) {
      console.error(JSON.stringify({ component: "daily-digest", account_id: account.id, error_type: err instanceof Error ? err.name : "unknown" }));
      if (jobClaimId) {
        await supabase.from("ia_job_claims").update({
          status: digestSendStarted ? "reconcile" : "error", finished_at: new Date().toISOString(),
        }).eq("id", jobClaimId);
      }
      results.push({ account: account.gmail_address, sent: false, error: "digest failed" });
    }
  }

  return new Response(JSON.stringify({ results }), {
    headers: { "Content-Type": "application/json" },
  });
});
