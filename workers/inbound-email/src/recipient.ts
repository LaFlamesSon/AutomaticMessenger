export const STABLE_ALIAS_RE = /^([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)@(?:inbound\.)?getcaughtup\.io$/i;
export const OPAQUE_ALIAS_RE = /^u([a-z0-9]{32,96})@inbound\.getcaughtup\.io$/i;
export const LEGACY_PLUS_ALIAS_RE = /^inbox\+([a-z0-9]{32,96})@inbound\.getcaughtup\.io$/i;
export const RESERVED_ALIAS_SLUGS = new Set([
  "abuse", "admin", "administrator", "api", "app", "billing", "caughtup", "contact", "email",
  "help", "hello", "inbound", "inbox", "info", "jobs", "legal", "mail", "marketing", "no-reply", "noreply",
  "postmaster", "privacy", "probe", "root", "sales", "security", "setup", "setup-probe", "status",
  "support", "team", "test", "webmaster", "www",
]);

export type ParsedInboundRecipient = {
  kind: "stable" | "opaque" | "legacy_plus";
  address: string;
  aliasToken: string;
};

export function parseInboundRecipient(envelopeTo: string): ParsedInboundRecipient | null {
  const address = envelopeTo.trim().toLowerCase();
  const opaque = address.match(OPAQUE_ALIAS_RE);
  if (opaque?.[1]) return { kind: "opaque", address, aliasToken: opaque[1].toLowerCase() };
  const legacy = address.match(LEGACY_PLUS_ALIAS_RE);
  if (legacy?.[1]) return { kind: "legacy_plus", address, aliasToken: legacy[1].toLowerCase() };
  const stable = address.match(STABLE_ALIAS_RE);
  if (stable?.[1]) {
    const slug = stable[1].toLowerCase();
    if (RESERVED_ALIAS_SLUGS.has(slug)) return null;
    return { kind: "stable", address, aliasToken: slug };
  }
  return null;
}
