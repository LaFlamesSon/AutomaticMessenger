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

function completionResponse(
  redirectUri: string | null,
  status: "sent" | "failed",
  errorCode?: string,
): Response {
  if (redirectUri) return completionRedirect(redirectUri, status, errorCode);
  if (status === "sent") {
    return page(
      "Gmail send test passed",
      "One fixed self-addressed test message was sent. Check the company account's Inbox and Sent folder.",
    );
  }
  return page(
    "Gmail send test failed",
    `The controlled test stopped safely (${
      errorCode ?? "unknown_error"
    }). No retry was started.`,
    400,
  );
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

function bytesBase64Url(value: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < value.length; offset += 0x8000) {
    binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/g,
    "",
  );
}

function base64UrlBytes(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return buffer;
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

async function signedBrowserState(clientSecret: string): Promise<string> {
  const expiresAt = Date.now() + 10 * 60_000;
  const unsigned = `v1.${expiresAt}.${crypto.randomUUID()}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(clientSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${bytesBase64Url(new Uint8Array(signature))}`;
}

async function validBrowserState(
  state: string,
  clientSecret: string,
): Promise<boolean> {
  const parts = state.split(".");
  if (
    parts.length !== 4 || parts[0] !== "v1" ||
    !/^\d{13}$/.test(parts[1]) ||
    !/^[0-9a-f-]{36}$/i.test(parts[2]) ||
    !/^[A-Za-z0-9_-]{43}$/.test(parts[3])
  ) return false;
  const expiresAt = Number(parts[1]);
  if (expiresAt <= Date.now() || expiresAt > Date.now() + 10 * 60_000) {
    return false;
  }
  const unsigned = parts.slice(0, 3).join(".");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(clientSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlBytes(parts[3]),
    new TextEncoder().encode(unsigned),
  );
}

function configuredProbe(config: Record<string, string>): {
  clientId: string;
  clientSecret: string;
  expectedEmail: string;
} | null {
  const clientId = config["ia_google_send_probe_client_id"] ?? "";
  const clientSecret = config["ia_google_send_probe_client_secret"] ?? "";
  const expectedEmail = (config["ia_google_send_probe_email"] ?? "").trim()
    .toLowerCase();
  if (
    config["ia_google_send_probe_enabled"] !== "true" ||
    !/^[0-9]+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/i.test(clientId) ||
    clientSecret.length < 20 ||
    !validEmail(expectedEmail)
  ) return null;
  return { clientId, clientSecret, expectedEmail };
}

function googleConsent(
  clientId: string,
  expectedEmail: string,
  state: string,
): URL {
  const consent = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  consent.searchParams.set("client_id", clientId);
  consent.searchParams.set("redirect_uri", selfUrl());
  consent.searchParams.set("response_type", "code");
  consent.searchParams.set("scope", `openid email profile ${REQUIRED_SCOPE}`);
  consent.searchParams.set("access_type", "offline");
  consent.searchParams.set("prompt", "consent");
  consent.searchParams.set("include_granted_scopes", "false");
  consent.searchParams.set("login_hint", expectedEmail);
  consent.searchParams.set("state", state);
  return consent;
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
  const probeConfig = configuredProbe(config);
  if (url.searchParams.get("start") === "1") {
    if (!probeConfig) {
      return page(
        "Gmail send test unavailable",
        "The controlled probe is not enabled.",
        503,
      );
    }
    const state = await signedBrowserState(probeConfig.clientSecret);
    return Response.redirect(
      googleConsent(probeConfig.clientId, probeConfig.expectedEmail, state)
        .toString(),
      302,
    );
  }

  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (!state || state.length > 200) {
    return page(
      "Gmail send test failed",
      "Missing or invalid OAuth response.",
      400,
    );
  }

  let redirectUri: string | null = null;
  if (state.startsWith("v1.")) {
    if (
      !probeConfig ||
      !(await validBrowserState(state, probeConfig.clientSecret))
    ) {
      return page(
        "Gmail send test failed",
        "This test expired or was invalid.",
        409,
      );
    }
  } else {
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
    redirectUri = claimed.redirect_uri;
  }
  if (url.searchParams.get("error") || !code) {
    return completionResponse(redirectUri, "failed", "oauth_denied");
  }

  if (!probeConfig) {
    return completionResponse(redirectUri, "failed", "probe_unavailable");
  }
  const { clientId, clientSecret, expectedEmail } = probeConfig;

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
    return completionResponse(
      redirectUri,
      "failed",
      "code_exchange_failed",
    );
  }
  const tokens = await tokenResponse.json().catch(() => null);
  if (!tokens || typeof tokens !== "object") {
    return completionResponse(
      redirectUri,
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
    return completionResponse(
      redirectUri,
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
    return completionResponse(
      redirectUri,
      "failed",
      "identity_check_failed",
    );
  }
  const profile = await profileResponse.json().catch(() => null);
  if (!profile || typeof profile !== "object") {
    return completionResponse(
      redirectUri,
      "failed",
      "identity_check_failed",
    );
  }
  const authorizedEmail = String(profile.email ?? "").trim().toLowerCase();
  if (
    profile.email_verified !== true || authorizedEmail !== expectedEmail ||
    !validEmail(authorizedEmail)
  ) {
    return completionResponse(
      redirectUri,
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
    return completionResponse(
      redirectUri,
      "failed",
      "gmail_send_failed",
    );
  }
  await boundedFetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: String(tokens.refresh_token) }),
  });
  return completionResponse(redirectUri, "sent");
});
