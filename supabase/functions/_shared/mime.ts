const CONTROL = /[\u0000-\u001f\u007f]/g;
const ADDRESS = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;

export function sanitizeHeader(value: unknown, max = 998): string {
  return String(value ?? "").replace(CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function parseStrictRecipient(value: unknown): string | null {
  const clean = sanitizeHeader(value, 320);
  const bracketed = clean.match(/^(?:[^<>]*\s)?<([^<>]+)>$/)?.[1]?.trim();
  const address = bracketed ?? clean;
  return ADDRESS.test(address) ? address.toLowerCase() : null;
}

export function sanitizeMessageIds(value: unknown): string {
  const clean = sanitizeHeader(value, 998);
  const ids = clean.match(/<[^<>\s@]+@[^<>\s]+>/g) ?? [];
  return ids.slice(0, 20).join(" ");
}

export function quoteFilename(value: unknown): string {
  const clean = sanitizeHeader(value, 180).replace(/["\\/]/g, "_").replace(/^\.+/, "");
  return (clean || "attachment").slice(-120);
}

export function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  try { return new TextDecoder().decode(Uint8Array.from(atob(normalized), (c) => c.charCodeAt(0))); }
  catch { return ""; }
}

export function payloadHeader(payload: any, name: string): string {
  return sanitizeHeader(payload?.headers?.find((h: any) => String(h.name).toLowerCase() === name.toLowerCase())?.value ?? "");
}

export function payloadText(payload: any): string {
  const walk = (part: any, wanted: string): string | null => {
    if (part?.mimeType === wanted && typeof part?.body?.data === "string") return decodeBase64Url(part.body.data);
    for (const child of part?.parts ?? []) { const found = walk(child, wanted); if (found !== null) return found; }
    return null;
  };
  return (walk(payload, "text/plain") ?? walk(payload, "text/html")?.replace(/<[^>]+>/g, " ") ?? "")
    .replace(/\u0000/g, "").slice(0, 100_000);
}
