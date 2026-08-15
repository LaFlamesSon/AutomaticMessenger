const DEFAULT_ZONE_ID = "78aebced52b382914920ab8d0f197fc8";
const INBOUND_WORKER = "caughtup-inbound-email";
const RULE_NAME = "CaughtUp inbound mailbox";
const MANAGED_MAILBOX = /^(?:u[a-z0-9]{32,96}|inbox\+[a-z0-9]{32,96})@inbound\.getcaughtup\.io$/i;

type RoutingMatcher = { type?: string; field?: string; value?: string };
type RoutingRule = { id?: string; name?: string; matchers?: RoutingMatcher[] };

export function cloudflareInboundRoutingConfigured(cfg: Record<string, string>): boolean {
  return Boolean(apiToken(cfg));
}

function apiToken(cfg: Record<string, string>): string {
  return String(cfg.ia_cloudflare_api_token || Deno.env.get("IA_CLOUDFLARE_API_TOKEN") || "").trim();
}

function zoneId(cfg: Record<string, string>): string {
  return String(cfg.ia_cloudflare_zone_id || Deno.env.get("IA_CLOUDFLARE_ZONE_ID") || DEFAULT_ZONE_ID).trim();
}

function authHeaders(cfg: Record<string, string>): HeadersInit {
  const token = apiToken(cfg);
  if (!token) throw new Error("inbound mailbox routing is unavailable");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

function rulesUrl(cfg: Record<string, string>, suffix = ""): string {
  return `https://api.cloudflare.com/client/v4/zones/${zoneId(cfg)}/email/routing/rules${suffix}`;
}

function matcherAddress(rule: RoutingRule): string {
  return (rule.matchers ?? []).find((matcher) => matcher.type === "literal" && matcher.field === "to")?.value?.trim().toLowerCase() ?? "";
}

async function cloudflareRequest(cfg: Record<string, string>, url: string, init: RequestInit): Promise<any> {
  const response = await fetch(url, {
    ...init,
    headers: { ...authHeaders(cfg), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 409 && init.method === "POST") return payload;
  if (!response.ok || payload?.success === false) {
    throw new Error("inbound mailbox routing is unavailable");
  }
  return payload;
}

async function listRoutingRules(cfg: Record<string, string>): Promise<RoutingRule[]> {
  const rules: RoutingRule[] = [];
  let page = 1;
  for (;;) {
    const payload = await cloudflareRequest(cfg, `${rulesUrl(cfg)}?per_page=50&page=${page}`, { method: "GET" });
    const batch = Array.isArray(payload?.result) ? payload.result : [];
    rules.push(...batch);
    const totalPages = Number(payload?.result_info?.total_pages || 1);
    if (page >= totalPages || batch.length === 0) break;
    page += 1;
  }
  return rules;
}

export async function ensureCloudflareInboundMailbox(
  cfg: Record<string, string>,
  address: string,
  previousAddress?: string | null,
): Promise<void> {
  const mailbox = address.trim().toLowerCase();
  if (!MANAGED_MAILBOX.test(mailbox)) throw new Error("inbound mailbox routing is unavailable");
  const rules = await listRoutingRules(cfg);
  if (!rules.some((rule) => matcherAddress(rule) === mailbox)) {
    await cloudflareRequest(cfg, rulesUrl(cfg), {
      method: "POST",
      body: JSON.stringify({
        enabled: true,
        name: RULE_NAME,
        matchers: [{ type: "literal", field: "to", value: mailbox }],
        actions: [{ type: "worker", value: [INBOUND_WORKER] }],
      }),
    });
  }
  const previous = String(previousAddress || "").trim().toLowerCase();
  if (!previous || previous === mailbox || !MANAGED_MAILBOX.test(previous)) return;
  for (const rule of rules) {
    if (rule.id && rule.name === RULE_NAME && matcherAddress(rule) === previous) {
      await cloudflareRequest(cfg, rulesUrl(cfg, `/${rule.id}`), { method: "DELETE" });
    }
  }
}
