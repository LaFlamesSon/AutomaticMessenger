// Gmail OAuth connect flow.
// Visit the function URL to start; Google redirects back here with ?code=,
// and the refresh token is stored in ia_gmail_accounts.
// Deploy with verify_jwt=false (it must be reachable from a browser).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SCOPE = "https://www.googleapis.com/auth/gmail.modify";

function selfUrl(req: Request): string {
  const url = new URL(req.url);
  return `${url.origin}${url.pathname}`;
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  // Config from Supabase Vault, env vars as fallback.
  const { data: cfgRows } = await supabase.rpc("ia_get_config");
  const CFG: Record<string, string> = Object.fromEntries(
    (cfgRows ?? []).map((r: any) => [r.name, r.secret]),
  );
  const clientId = CFG["ia_google_client_id"] ?? Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
  const clientSecret = CFG["ia_google_client_secret"] ?? Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
  const code = url.searchParams.get("code");

  if (!code) {
    // Step 1: send the user to Google's consent screen.
    const consent = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    consent.searchParams.set("client_id", clientId);
    consent.searchParams.set("redirect_uri", selfUrl(req));
    consent.searchParams.set("response_type", "code");
    consent.searchParams.set("scope", SCOPE);
    consent.searchParams.set("access_type", "offline");
    consent.searchParams.set("prompt", "consent");
    return Response.redirect(consent.toString(), 302);
  }

  // Step 2: exchange the code for tokens.
  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: selfUrl(req),
    }),
  });
  if (!tokenResp.ok) {
    return new Response(`Token exchange failed: ${await tokenResp.text()}`, { status: 400 });
  }
  const tokens = await tokenResp.json();
  if (!tokens.refresh_token) {
    return new Response(
      "Google did not return a refresh token. Remove the app's access at " +
        "https://myaccount.google.com/permissions and try again.",
      { status: 400 },
    );
  }

  // Identify the mailbox.
  const profileResp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const { emailAddress } = await profileResp.json();

  const { data: user, error: userErr } = await supabase
    .from("ia_users")
    .upsert({ email: emailAddress.toLowerCase() }, { onConflict: "email" })
    .select()
    .single();
  if (userErr) return new Response(`DB error: ${userErr.message}`, { status: 500 });

  const { error: acctErr } = await supabase.from("ia_gmail_accounts").upsert(
    {
      user_id: user.id,
      gmail_address: emailAddress.toLowerCase(),
      refresh_token: tokens.refresh_token,
    },
    { onConflict: "gmail_address" },
  );
  if (acctErr) return new Response(`DB error: ${acctErr.message}`, { status: 500 });

  // Seed a default voice profile so the agent works before any customization.
  await supabase.from("ia_voice_profiles")
    .upsert({ user_id: user.id }, { onConflict: "user_id", ignoreDuplicates: true });

  return new Response(
    `<html><body style="font-family: system-ui; max-width: 40rem; margin: 4rem auto;">
      <h2>✅ ${emailAddress} connected</h2>
      <p>The inbox agent will start triaging on its next sweep. Drafts appear in
      your Gmail drafts folder — nothing is ever sent automatically.</p>
    </body></html>`,
    { headers: { "Content-Type": "text/html" } },
  );
});
