// Gmail OAuth callback. Consent must be initiated by authenticated
// agent-api:gmail_connect_start, which creates a one-time identity-bound state.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { allowedChromeRedirect } from "../_shared/oauth.ts";

function selfUrl(): string {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/gmail-oauth`;
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function html(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

function page(title: string, detail: string, status = 200): Response {
  return new Response(
    `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
    <body style="font-family:system-ui;max-width:40rem;margin:4rem auto;line-height:1.6">
      <h2>${html(title)}</h2><p>${html(detail)}</p><p>You may close this window.</p>
    </body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

function completionRedirect(redirectUri: string, status: "connected" | "failed", errorCode?: string): Response {
  const target = new URL(redirectUri);
  target.searchParams.set("caughtup_gmail", status);
  if (errorCode) target.searchParams.set("error", errorCode);
  return Response.redirect(target.toString(), 302);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET") return page("Connection failed", "GET callback required.", 405);
  const url = new URL(req.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (!code || !state || state.length > 200) return page("Connection failed", "Missing or invalid OAuth response.", 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: cfgRows, error: cfgError } = await supabase.rpc("ia_get_config");
  if (cfgError) return page("Connection failed", "Configuration is unavailable.", 503);
  const CFG: Record<string, string> = Object.fromEntries((cfgRows ?? []).map((row: any) => [row.name, row.secret]));

  const stateHash = await sha256(state);
  const now = new Date().toISOString();
  const { data: claimed, error: stateError } = await supabase.from("ia_oauth_states")
    .update({ used_at: now }).eq("state_hash", stateHash).is("used_at", null).gt("expires_at", now)
    .select("id, user_id, redirect_uri").maybeSingle();
  if (stateError || !claimed) return page("Connection failed", "This connection request expired or was already used.", 409);
  if (!allowedChromeRedirect(claimed.redirect_uri, CFG["ia_allowed_extension_ids"] ?? "")) {
    return page("Connection failed", "The extension callback is not allowed.", 400);
  }

  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CFG["ia_google_client_id"],
      client_secret: CFG["ia_google_client_secret"],
      code,
      grant_type: "authorization_code",
      redirect_uri: selfUrl(),
    }),
  });
  if (!tokenResp.ok) return completionRedirect(claimed.redirect_uri, "failed", "code_exchange_failed");
  const tokens = await tokenResp.json();
  if (!tokens.refresh_token || !tokens.access_token) {
    return completionRedirect(claimed.redirect_uri, "failed", "offline_access_missing");
  }

  const profileResp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!profileResp.ok) return completionRedirect(claimed.redirect_uri, "failed", "gmail_profile_failed");
  const gmailProfile = await profileResp.json();
  const gmailAddress = String(gmailProfile.emailAddress ?? "").toLowerCase();
  if (!gmailAddress) return completionRedirect(claimed.redirect_uri, "failed", "gmail_address_missing");

  const { data: existing, error: lookupError } = await supabase.from("ia_gmail_accounts")
    .select("id, user_id").eq("gmail_address", gmailAddress).maybeSingle();
  if (lookupError) return completionRedirect(claimed.redirect_uri, "failed", "account_lookup_failed");
  if (existing && existing.user_id !== claimed.user_id) {
    return completionRedirect(claimed.redirect_uri, "failed", "account_already_connected");
  }

  const accountWrite = existing
    ? supabase.from("ia_gmail_accounts").update({ refresh_token: tokens.refresh_token, connected_at: now })
      .eq("id", existing.id).eq("user_id", claimed.user_id)
    : supabase.from("ia_gmail_accounts").insert({
      user_id: claimed.user_id, gmail_address: gmailAddress, refresh_token: tokens.refresh_token,
    });
  const { error: accountError } = await accountWrite;
  if (accountError) return completionRedirect(claimed.redirect_uri, "failed", "account_save_failed");

  const { error: profileError } = await supabase.from("ia_voice_profiles")
    .upsert({ user_id: claimed.user_id }, { onConflict: "user_id", ignoreDuplicates: true });
  if (profileError) return completionRedirect(claimed.redirect_uri, "failed", "profile_setup_failed");

  return completionRedirect(claimed.redirect_uri, "connected");
});
