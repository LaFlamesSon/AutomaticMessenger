const INBOUND_HOST = "inbound.getcaughtup.io";

export function inboundAliasAddress(token: string): string {
  return `u${token}@${INBOUND_HOST}`;
}

export function envelopeMatchesAliasToken(envelopeTo: string, token: string): boolean {
  const value = envelopeTo.trim().toLowerCase();
  const normalized = token.trim().toLowerCase();
  return value === inboundAliasAddress(normalized) || value === `inbox+${normalized}@${INBOUND_HOST}`;
}

export function isLegacyPlusInboundAlias(address: string): boolean {
  return /^inbox\+[a-z0-9]{32,96}@inbound\.getcaughtup\.io$/i.test(address.trim());
}
