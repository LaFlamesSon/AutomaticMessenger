const CONTROL = /[\u0000-\u001f\u007f]/g;
const ADDRESS = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;

export function sanitizeHeader(value: unknown, max = 998): string {
  return String(value ?? "").replace(CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function encodeHeaderSubject(subject: string): string {
  const clean = sanitizeHeader(subject, 500);
  if (/^[\x20-\x7E]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${btoa(unescape(encodeURIComponent(clean)))}?=`;
}

/** Map common punctuation to ASCII, then drop remaining non-ASCII (emoji included). */
export function asciiEmailCopy(value: unknown, max = 20_000): string {
  let text = String(value ?? "");
  text = text
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/[\u2022\u2023\u2043\u00B7\u2219]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\t\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ");
  text = text.replace(/[^\n\r\x20-\x7E]/g, "");
  return text.trim().slice(0, max);
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

export interface StableDraftAttachment {
  filename: string;
  mime_type: string;
  byte_size: number;
  content_sha256: string;
}

export function stableDraftPreview(input: {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  attachments: StableDraftAttachment[];
}): Record<string, unknown> {
  const addresses = (values: string[]) => values.map((value) => sanitizeHeader(value, 320).toLowerCase());
  return {
    to: addresses(input.to),
    cc: addresses(input.cc),
    bcc: addresses(input.bcc),
    subject: sanitizeHeader(input.subject, 500),
    body: String(input.body ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n"),
    attachments: input.attachments.map((attachment) => ({
      filename: sanitizeHeader(attachment.filename, 180),
      mime_type: sanitizeHeader(attachment.mime_type, 100).toLowerCase(),
      byte_size: Number(attachment.byte_size),
      content_sha256: String(attachment.content_sha256),
    })),
  };
}
