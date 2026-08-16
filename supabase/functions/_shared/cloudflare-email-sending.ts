const ROUTE_PROBE_FROM = "setup-probe@getcaughtup.io";
const ROUTE_PROBE_NAME = "CaughtUp";

function apiToken(cfg: Record<string, string>): string {
  return String(cfg.ia_cloudflare_api_token || Deno.env.get("IA_CLOUDFLARE_API_TOKEN") || "").trim();
}

function accountId(cfg: Record<string, string>): string {
  return String(cfg.ia_cloudflare_account_id || Deno.env.get("IA_CLOUDFLARE_ACCOUNT_ID") || "").trim();
}

export function cloudflareEmailSendingConfigured(cfg: Record<string, string>): boolean {
  return Boolean(apiToken(cfg) && accountId(cfg));
}

export async function sendExternalRouteProbe(
  cfg: Record<string, string>,
  input: { gmailAddress: string; token: string },
): Promise<void> {
  const token = apiToken(cfg);
  const account = accountId(cfg);
  const to = String(input.gmailAddress || "").trim().toLowerCase();
  const probeToken = String(input.token || "").trim().toLowerCase();
  if (!token || !account || !to || !/^[0-9a-f]{48}$/.test(probeToken)) {
    throw new Error("route_probe_unavailable");
  }
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/email/sending/send`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: { address: ROUTE_PROBE_FROM, name: ROUTE_PROBE_NAME },
        to: [{ address: to }],
        subject: `CaughtUp connection check ${probeToken}`,
        text: "CaughtUp is confirming that Gmail forwarded this message. You can ignore it.",
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) throw new Error("route_probe_unavailable");
}
