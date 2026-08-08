// TikTok Shop creator OAuth callback. Consent starts in authenticated agent-api.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { allowedChromeRedirect } from "../_shared/oauth.ts";
import { normalizeGrantedScopes, TIKTOK_CREATOR_SCOPE, tokenExpiryIso } from "../_shared/tiktok.ts";

function selfUrl(): string { return `${Deno.env.get("SUPABASE_URL")}/functions/v1/tiktok-oauth`; }
async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function html(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
function page(title: string, detail: string, status = 200): Response {
  return new Response(`<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="font-family:system-ui;max-width:40rem;margin:4rem auto;line-height:1.6"><h2>${html(title)}</h2><p>${html(detail)}</p><p>You may close this window.</p></body></html>`, {
    status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
function completionRedirect(redirectUri: string, status: "connected" | "failed", errorCode?: string): Response {
  const target = new URL(redirectUri);
  target.searchParams.set("caughtup_tiktok", status);
  if (errorCode) target.searchParams.set("error", errorCode);
  return Response.redirect(target.toString(), 302);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET") return page("Connection failed", "GET callback required.", 405);
  const url = new URL(req.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (!state || state.length > 200) return page("Connection failed", "Missing or invalid OAuth response.", 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: rows, error: configError } = await supabase.rpc("ia_get_config");
  if (configError) return page("Connection failed", "Configuration is unavailable.", 503);
  const config: Record<string, string> = Object.fromEntries((rows ?? []).map((row: any) => [row.name, row.secret]));
  const now = new Date().toISOString();
  const { data: claimed, error: stateError } = await supabase.from("ia_tiktok_oauth_states")
    .update({ used_at: now }).eq("state_hash", await sha256(state)).is("used_at", null).gt("expires_at", now)
    .select("user_id,redirect_uri").maybeSingle();
  if (stateError || !claimed) return page("Connection failed", "This connection request expired or was already used.", 409);
  if (!allowedChromeRedirect(claimed.redirect_uri, config["ia_allowed_extension_ids"] ?? "")) {
    return page("Connection failed", "The extension callback is not allowed.", 400);
  }
  if (!code || url.searchParams.get("error")) return completionRedirect(claimed.redirect_uri, "failed", "authorization_denied");

  const tokenUrl = new URL("https://auth.tiktok-shops.com/api/v2/token/get");
  tokenUrl.search = new URLSearchParams({
    app_key: config["ia_tiktok_app_key"] ?? "", app_secret: config["ia_tiktok_app_secret"] ?? "",
    auth_code: code, grant_type: "authorized_code",
  }).toString();
  const tokenResponse = await fetch(tokenUrl);
  const payload = await tokenResponse.json().catch(() => ({}));
  const tokens = payload?.data ?? {};
  if (!tokenResponse.ok || Number(payload?.code ?? -1) !== 0) return completionRedirect(claimed.redirect_uri, "failed", "code_exchange_failed");
  const scopes = normalizeGrantedScopes(tokens.granted_scopes);
  if (Number(tokens.user_type) !== 1) return completionRedirect(claimed.redirect_uri, "failed", "creator_account_required");
  if (!scopes.includes(TIKTOK_CREATOR_SCOPE)) return completionRedirect(claimed.redirect_uri, "failed", "creator_scope_missing");
  if (!tokens.open_id || !tokens.access_token || !tokens.refresh_token) return completionRedirect(claimed.redirect_uri, "failed", "token_response_invalid");

  const credential = {
    access_token: String(tokens.access_token), refresh_token: String(tokens.refresh_token),
    access_expires_at: tokenExpiryIso(tokens.access_token_expire_in),
    refresh_expires_at: tokenExpiryIso(tokens.refresh_token_expire_in),
  };
  const { error: saveError } = await supabase.rpc("ia_upsert_tiktok_connection", {
    p_user_id: claimed.user_id, p_external_account_ref: String(tokens.open_id),
    p_credential: credential, p_scopes: scopes,
    p_metadata: { seller_name: String(tokens.seller_name ?? "").slice(0, 160) },
  });
  if (saveError) return completionRedirect(claimed.redirect_uri, "failed", "account_save_failed");
  const { data: preference, error: preferenceReadError } = await supabase.from("ia_opportunity_preferences")
    .select("platforms").eq("user_id", claimed.user_id).maybeSingle();
  if (preferenceReadError) return completionRedirect(claimed.redirect_uri, "failed", "preference_setup_failed");
  const platforms = [...new Set([...(Array.isArray(preference?.platforms) ? preference.platforms : []), "tiktok"])];
  const { error: preferenceError } = await supabase.from("ia_opportunity_preferences")
    .upsert({ user_id: claimed.user_id, enabled: true, platforms }, { onConflict: "user_id" });
  if (preferenceError) return completionRedirect(claimed.redirect_uri, "failed", "preference_setup_failed");
  return completionRedirect(claimed.redirect_uri, "connected");
});
