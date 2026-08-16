export const STABLE_INBOUND_HOST = "getcaughtup.io";
export const LEGACY_INBOUND_HOST = "inbound.getcaughtup.io";
export const ROUTE_PROBE_SENDER = "setup-probe@getcaughtup.io";

export const RESERVED_ALIAS_SLUGS = new Set([
  "abuse", "admin", "administrator", "api", "app", "billing", "caughtup", "contact", "email",
  "help", "hello", "inbound", "info", "jobs", "legal", "mail", "marketing", "no-reply", "noreply",
  "postmaster", "privacy", "probe", "root", "sales", "security", "setup", "setup-probe", "status",
  "support", "team", "test", "webmaster", "www",
]);

export const STABLE_ALIAS_RE = /^([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)@getcaughtup\.io$/i;
export const OPAQUE_ALIAS_RE = /^u([a-z0-9]{32,96})@inbound\.getcaughtup\.io$/i;
export const LEGACY_PLUS_ALIAS_RE = /^inbox\+([a-z0-9]{32,96})@inbound\.getcaughtup\.io$/i;

export type ParsedInboundRecipient = {
  kind: "stable" | "opaque" | "legacy_plus";
  address: string;
  aliasToken: string;
  slug?: string;
  token?: string;
};

export type AliasLookupRow = {
  alias_address?: string | null;
  legacy_alias_address?: string | null;
};

export function inboundAliasAddress(token: string): string {
  return `u${token}@${LEGACY_INBOUND_HOST}`;
}

export function stableAliasAddress(slug: string): string {
  return `${slug.trim().toLowerCase()}@${STABLE_INBOUND_HOST}`;
}

export function parseInboundRecipient(envelopeTo: string): ParsedInboundRecipient | null {
  const address = envelopeTo.trim().toLowerCase();
  const stable = address.match(STABLE_ALIAS_RE);
  if (stable) {
    const slug = stable[1].toLowerCase();
    if (RESERVED_ALIAS_SLUGS.has(slug)) return null;
    return { kind: "stable", address, aliasToken: slug, slug };
  }
  const opaque = address.match(OPAQUE_ALIAS_RE);
  if (opaque) {
    const token = opaque[1].toLowerCase();
    return { kind: "opaque", address, aliasToken: token, token };
  }
  const legacy = address.match(LEGACY_PLUS_ALIAS_RE);
  if (legacy) {
    const token = legacy[1].toLowerCase();
    return { kind: "legacy_plus", address, aliasToken: token, token };
  }
  return null;
}

export function envelopeMatchesAliasToken(envelopeTo: string, token: string): boolean {
  const recipient = parseInboundRecipient(envelopeTo);
  return Boolean(recipient && recipient.aliasToken === token.trim().toLowerCase());
}

export function envelopeMatchesAlias(envelopeTo: string, alias: AliasLookupRow): boolean {
  const address = envelopeTo.trim().toLowerCase();
  return address === String(alias.alias_address || "").trim().toLowerCase()
    || address === String(alias.legacy_alias_address || "").trim().toLowerCase();
}

export function isLegacyPlusInboundAlias(address: string): boolean {
  return LEGACY_PLUS_ALIAS_RE.test(address.trim());
}

export function isOpaqueOrLegacyInboundAlias(address: string): boolean {
  const value = address.trim().toLowerCase();
  return OPAQUE_ALIAS_RE.test(value) || LEGACY_PLUS_ALIAS_RE.test(value);
}

export function isStableInboundAlias(address: string): boolean {
  const recipient = parseInboundRecipient(address);
  return recipient?.kind === "stable";
}

export function isReservedAliasSlug(slug: string): boolean {
  return RESERVED_ALIAS_SLUGS.has(slug.trim().toLowerCase());
}

export function proposedAliasSlug(gmailAddress: string): string {
  const match = String(gmailAddress || "").trim().toLowerCase().match(/^([^@]+)@([^@]+)$/);
  if (!match) return "user";
  let local = match[1].replace(/\+.*$/, "");
  const domain = match[2];
  if (domain === "gmail.com" || domain === "googlemail.com") local = local.replace(/\./g, "");
  local = local.replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "");
  if (local.length > 64) local = local.slice(0, 64).replace(/-+$/g, "");
  if (!local || isReservedAliasSlug(local)) return "user";
  return local;
}

export function routeVerifiedStatus(status: string | null | undefined): boolean {
  return status === "route_verified" || status === "active";
}

export function canonicalForwardingStatus(status: string | null | undefined): string {
  if (!status || status === "not_started") return "not_started";
  if (status === "pending") return "address_ready";
  if (status === "verification_received") return "google_verification_received";
  if (status === "active") return "route_verified";
  return status;
}

export function googleConfirmationStatuses(): string[] {
  return ["address_ready", "pending"];
}
