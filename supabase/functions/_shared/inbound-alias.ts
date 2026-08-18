export const STABLE_INBOUND_HOST = "inbound.getcaughtup.io";
export const LEGACY_INBOUND_HOST = "inbound.getcaughtup.io";
export const ROUTE_PROBE_SENDER = "setup-probe@getcaughtup.io";

export const RESERVED_ALIAS_SLUGS = new Set([
  "abuse", "admin", "administrator", "api", "app", "billing", "caughtup", "contact", "email",
  "help", "hello", "inbound", "inbox", "info", "jobs", "legal", "mail", "marketing", "no-reply", "noreply",
  "postmaster", "privacy", "probe", "root", "sales", "security", "setup", "setup-probe", "status",
  "support", "team", "test", "user", "webmaster", "www",
]);

export const STABLE_ALIAS_RE = /^([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)@(?:inbound\.)?getcaughtup\.io$/i;
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
  const stable = address.match(STABLE_ALIAS_RE);
  if (stable) {
    const slug = stable[1].toLowerCase();
    if (RESERVED_ALIAS_SLUGS.has(slug)) return null;
    return { kind: "stable", address, aliasToken: slug, slug };
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

function normalizeAliasLocalPart(localPart: string, domain: string): string | null {
  let local = String(localPart || "").trim().toLowerCase().replace(/\+.*$/, "");
  if (domain === "gmail.com" || domain === "googlemail.com") local = local.replace(/\./g, "");
  local = local.replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "");
  if (local.length > 64) local = local.slice(0, 64).replace(/-+$/g, "");
  if (!local || isReservedAliasSlug(local)) return null;
  return local;
}

function slugFromEmailAddress(address: string): string | null {
  const match = String(address || "").trim().toLowerCase().match(/^([^@]+)@([^@]+)$/);
  if (!match) return null;
  return normalizeAliasLocalPart(match[1], match[2]);
}

function deterministicAliasSlug(seed: string): string {
  let hash = 0;
  for (const character of seed) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  const suffix = Math.abs(hash).toString(36).slice(0, 8).padEnd(8, "0");
  return `inbox-${suffix}`;
}

/** Prefer the connected Gmail local part; fall back to signup identity email; never mint generic "user". */
export function proposedAliasSlug(gmailAddress: string, identityEmail = ""): string {
  const fromGmail = slugFromEmailAddress(gmailAddress);
  if (fromGmail) return fromGmail;
  const fromIdentity = slugFromEmailAddress(identityEmail);
  if (fromIdentity) return fromIdentity;
  return deterministicAliasSlug(String(gmailAddress || identityEmail || "caughtup"));
}

export function gmailCafForwardedAlias(envelopeFrom: string): string | null {
  const match = String(envelopeFrom || "").trim().toLowerCase()
    .match(/^[^+@]+\+caf_=([^=]+)=([^@]+)@(?:gmail|googlemail)\.com$/);
  if (!match) return null;
  return `${match[1]}@${match[2]}`;
}

export function cafActivationStatuses(): string[] {
  return ["address_ready", "google_verification_received", "awaiting_gmail_enable", "verifying_route"];
}

export function cafForwardToAlias(envelopeFrom: string, alias: AliasLookupRow): boolean {
  const forwardedTo = gmailCafForwardedAlias(envelopeFrom);
  return Boolean(forwardedTo && envelopeMatchesAlias(forwardedTo, alias));
}

export function routeProbeSubjectToken(subject: string): string | null {
  return String(subject || "").match(/CaughtUp connection check ([0-9a-f]{48})/i)?.[1]?.toLowerCase() ?? null;
}

export function routeProbeClaimToken(input: {
  subject: string;
  from: string;
  envelopeFrom: string;
  aliasAddress?: string | null;
  legacyAliasAddress?: string | null;
}): string | null {
  const token = routeProbeSubjectToken(input.subject);
  if (!token) return null;
  const from = String(input.from || "").trim().toLowerCase();
  const envelope = String(input.envelopeFrom || "").trim().toLowerCase();
  if (from === ROUTE_PROBE_SENDER || envelope === ROUTE_PROBE_SENDER) return token;
  const forwardedTo = gmailCafForwardedAlias(envelope);
  if (!forwardedTo) return null;
  const aliases = [input.aliasAddress, input.legacyAliasAddress]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  return aliases.includes(forwardedTo) ? token : null;
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
