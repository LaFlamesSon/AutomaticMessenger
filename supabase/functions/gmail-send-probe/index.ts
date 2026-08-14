// One-time OAuth acceptance probe for the replacement gmail.send-only client.
// The authenticated extension creates a short-lived state through agent-api.
// This callback sends one fixed message to the authorized account itself and
// intentionally does not persist Google access or refresh tokens.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { allowedChromeRedirect } from "../_shared/oauth.ts";

const REQUIRED_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const TEST_MARKER = "gmail-send-probe-v1";

function selfUrl(): string {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/gmail-send-probe`;
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes)).map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function html(value: string): string {
  return value.replace(/[&<>"']/g, (char) =>
    ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char]!);
}

function page(title: string, detail: string, status = 200): Response {
  return new Response(
    `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
    <body style="font-family:system-ui;max-width:40rem;margin:4rem auto;line-height:1.6">
      <h2>${html(title)}</h2><p>${
      html(detail)
    }</p><p>You may close this window.</p>
    </body></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}

function completionRedirect(
  redirectUri: string,
  status: "sent" | "failed",
  errorCode?: string,
): Response {
  const target = new URL(redirectUri);
  target.searchParams.set("caughtup_gmail_probe", status);
  if (errorCode) target.searchParams.set("error", errorCode);
  return Response.redirect(target.toString(), 302);
}

function base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/g,
    "",
  );
}

function validEmail(value: string): boolean {
  return /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(value);
}

async function boundedFetch(
  input: string,
  init: RequestInit,
): Promise<Response | null> {
  try {
    return await fetch(input, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch {
    return null;
  }
}

function rawSelfTest(email: string): string {
  const messageId = `<${crypto.randomUUID()}@oauth-test.getcaughtup.io>`;
  return [
    `From: CaughtUp OAuth Test <${email}>`,
    `To: ${email}`,
    "Subject: CaughtUp gmail.send OAuth test",
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    `X-CaughtUp-Test: ${TEST_MARKER}`,
    "Auto-Submitted: auto-generated",
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    "This fixed, self-addressed message confirms that CaughtUp can use the minimal gmail.send OAuth scope.",
    "The probe did not read inbox mail and did not retain the Google access or refresh token.",
    "",
  ].join("\r\n");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET") {
    return page("Gmail send test failed", "GET callback required.", 405);
  }
  const url = new URL(req.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (!state || state.length > 200) {
    return page(
      "Gmail send test failed",
      "Missing or invalid OAuth response.",
      400,
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: cfgRows, error: cfgError } = await supabase.rpc(
    "ia_get_config",
  );
  if (cfgError) {
    return page("Gmail send test failed", "Configuration is unavailable.", 503);
  }
  const config: Record<string, string> = Object.fromEntries(
    (cfgRows ?? []).map((
      row: { name: string; secret: string },
    ) => [row.name, row.secret]),
  );

  const stateHash = await sha256(state);
  const now = new Date().toISOString();
  const { data: claimed, error: stateError } = await supabase.from(
    "ia_oauth_states",
  )
    .update({ used_at: now }).eq("state_hash", stateHash).is("used_at", null)
    .gt("expires_at", now)
    .select("id,user_id,redirect_uri").maybeSingle();
  if (stateError || !claimed) {
    return page(
      "Gmail send test failed",
      "This test expired or was already used.",
      409,
    );
  }
  if (
    !allowedChromeRedirect(
      claimed.redirect_uri,
      config["ia_allowed_extension_ids"] ?? "",
    )
  ) {
    return page(
      "Gmail send test failed",
      "The extension callback is not allowed.",
      400,
    );
  }
  if (url.searchParams.get("error") || !code) {
    return completionRedirect(claimed.redirect_uri, "failed", "oauth_denied");
  }

  const clientId = config["ia_google_send_probe_client_id"] ?? "";
  const clientSecret = config["ia_google_send_probe_client_secret"] ?? "";
  const expectedEmail = (config["ia_google_send_probe_email"] ?? "").trim()
    .toLowerCase();
  if (
    config["ia_google_send_probe_enabled"] !== "true" ||
    !/^[0-9]+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/i.test(clientId) ||
    clientSecret.length < 20 ||
    !validEmail(expectedEmail)
  ) {
    return completionRedirect(
      claimed.redirect_uri,
      "failed",
      "probe_unavailable",
    );
  }

  const tokenResponse = await boundedFetch(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: selfUrl(),
      }),
    },
  );
  if (!tokenResponse?.ok) {
    return completionRedirect(
      claimed.redirect_uri,
      "failed",
      "code_exchange_failed",
    );
  }
  const tokens = await tokenResponse.json().catch(() => null);
  if (!tokens || typeof tokens !== "object") {
    return completionRedirect(
      claimed.redirect_uri,
      "failed",
      "code_exchange_failed",
    );
  }
  const grantedScopes = new Set(
    String(tokens.scope ?? "").split(/\s+/).filter(Boolean),
  );
  if (
    !tokens.access_token || !tokens.refresh_token ||
    !grantedScopes.has(REQUIRED_SCOPE)
  ) {
    return completionRedirect(
      claimed.redirect_uri,
      "failed",
      "minimal_scope_missing",
    );
  }

  const profileResponse = await boundedFetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    },
  );
  if (!profileResponse?.ok) {
    return completionRedirect(
      claimed.redirect_uri,
      "failed",
      "identity_check_failed",
    );
  }
  const profile = await profileResponse.json().catch(() => null);
  if (!profile || typeof profile !== "object") {
    return completionRedirect(
      claimed.redirect_uri,
      "failed",
      "identity_check_failed",
    );
  }
  const authorizedEmail = String(profile.email ?? "").trim().toLowerCase();
  if (
    profile.email_verified !== true || authorizedEmail !== expectedEmail ||
    !validEmail(authorizedEmail)
  ) {
    return completionRedirect(
      claimed.redirect_uri,
      "failed",
      "wrong_test_account",
    );
  }

  const sendResponse = await boundedFetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: base64Url(rawSelfTest(authorizedEmail)) }),
    },
  );
  if (!sendResponse?.ok) {
    return completionRedirect(
      claimed.redirect_uri,
      "failed",
      "gmail_send_failed",
    );
  }
  await boundedFetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: String(tokens.refresh_token) }),
  });
  return completionRedirect(claimed.redirect_uri, "sent");
});
