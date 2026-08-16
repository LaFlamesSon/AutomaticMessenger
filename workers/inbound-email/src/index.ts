import PostalMime, { type Address, type Email } from "postal-mime";
import { parseInboundRecipient } from "./recipient";

const MAX_RAW_BYTES = 10_000_000;
const MAX_BODY_CHARS = 100_000;
const MAX_ATTACHMENTS = 25;
const GOOGLE_FORWARDING_SENDER = "forwarding-noreply@google.com";

function clean(value: unknown, max: number): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function messageIds(value: unknown): string {
  return (clean(value, 4000).match(/<[^<>\s@]+@[^<>\s]+>/g) ?? []).slice(0, 20).join(" ");
}

function header(email: Email, name: string, max = 998): string {
  return clean(email.headers.find((item) => item.key === name.toLowerCase())?.value ?? "", max);
}

function mailbox(address: Address | undefined): string {
  if (!address) return "";
  if (Array.isArray(address.group)) return address.group.map((item) => item.address).filter(Boolean).join(", ");
  const email = clean(address.address, 320);
  const name = clean(address.name, 160);
  return name && email ? `${name} <${email}>` : email;
}

function htmlToText(html: string): string {
  return html
    .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function base64MimeText(rawText: string): string {
  const decoded: string[] = [];
  const parts = rawText.split(/\r?\n--[^\r\n]+/);
  for (const part of parts) {
    if (!/content-transfer-encoding:\s*base64/i.test(part)) continue;
    const body = part.split(/\r?\n\r?\n/, 2)[1]?.replace(/\s+/g, "") ?? "";
    if (!body || body.length > 200_000 || !/^[a-z0-9+/]+=*$/i.test(body)) continue;
    try {
      decoded.push(new TextDecoder().decode(Uint8Array.from(atob(body), (character) => character.charCodeAt(0))));
    } catch { /* malformed MIME part is ignored */ }
  }
  return decoded.join("\n");
}

function quotedPrintableText(value: string): string {
  return value
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9a-f]{2})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function decodeControlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return code > 31 && code < 127 ? String.fromCharCode(code) : " ";
    })
    .replace(/&#([0-9]+);/g, (_match, decimal: string) => {
      const code = Number.parseInt(decimal, 10);
      return code > 31 && code < 127 ? String.fromCharCode(code) : " ";
    });
}

function decodeControlPercents(value: string): string {
  return value.replace(/%([0-9a-f]{2})/gi, (_match, hex: string) => {
    const code = Number.parseInt(hex, 16);
    if (code === 0x5b || code === 0x5d) return _match;
    return code > 31 && code < 127 ? String.fromCharCode(code) : _match;
  });
}

function unwrapGoogleRedirect(value: string): string {
  const wrapped = value.match(/https:\/\/www\.google\.com\/url\?[^'"\s<>]*[?&]q=([^&'"\s<>]+)/i)?.[1];
  if (!wrapped) return value;
  try { return `${value}\n${decodeURIComponent(wrapped)}`; } catch { return `${value}\n${wrapped}`; }
}

function extractGoogleConfirmUrl(searchable: string): string | null {
  const decoded = unwrapGoogleRedirect(decodeControlPercents(decodeControlEntities(quotedPrintableText(searchable))));
  const direct = decoded
    .match(/https:\/\/(?:mail-settings|mail)\.google\.com\/mail\/vf-[^\s<>'"]+/i)?.[0]
    ?.replace(/[).,]+$/, "");
  if (direct) return direct;
  const relative = decoded.match(/\/mail\/vf-[A-Za-z0-9%_\-\[\]]+/i)?.[0];
  return relative ? `https://mail-settings.google.com${relative}` : null;
}

function extractGoogleConfirmCode(subject: string, searchable: string): string | null {
  return subject.match(/\(#\s*([0-9]{6,20})\s*\)/)?.[1]
    ?? searchable.match(/confirmation\s+code\s*[:#]?\s*([0-9]{6,20})/i)?.[1]
    ?? searchable.match(/\bcode\s*[:#]\s*([0-9]{6,20})\b/i)?.[1]
    ?? null;
}

function attachmentControlText(email: Email): string {
  const decoded: string[] = [];
  for (const attachment of email.attachments.slice(0, MAX_ATTACHMENTS)) {
    const mimeType = String(attachment.mimeType ?? "");
    if (mimeType && !/^(?:text\/(?:plain|html)|message\/rfc822|application\/octet-stream)$/i.test(mimeType)) continue;
    if (attachmentSize(attachment.content) > 200_000) continue;
    try {
      const bytes = typeof attachment.content === "string"
        ? new TextEncoder().encode(attachment.content)
        : attachment.content instanceof ArrayBuffer
        ? new Uint8Array(attachment.content)
        : attachment.content;
      decoded.push(new TextDecoder().decode(bytes));
    } catch { /* malformed nested text is ignored */ }
  }
  return decoded.join("\n");
}

function googleForwardingControlText(
  message: ForwardableEmailMessage,
  email: Email,
  text: string,
  raw?: ArrayBuffer,
): string {
  const subject = clean(email.subject, 500);
  if (clean(message.from, 320).toLowerCase() !== GOOGLE_FORWARDING_SENDER ||
      !/gmail forwarding confirmation/i.test(subject)) return text;
  const rawText = raw ? new TextDecoder().decode(raw) : "";
  const rawControlText = quotedPrintableText(rawText);
  const decodedMimeText = raw ? base64MimeText(rawText) : "";
  const searchable = `${subject}\n${text}\n${String(email.html ?? "")}\n` +
    `${attachmentControlText(email)}\n${rawControlText}\n${quotedPrintableText(decodedMimeText)}`;
  const code = extractGoogleConfirmCode(subject, searchable);
  const url = extractGoogleConfirmUrl(searchable);
  return [text, code ? `Confirmation code: ${code}` : "", url ?? ""].filter(Boolean).join("\n");
}

function attachmentSize(content: ArrayBuffer | Uint8Array | string): number {
  if (typeof content === "string") return new TextEncoder().encode(content).byteLength;
  return content.byteLength;
}

export function aliasToken(recipient: string): string | null {
  return parseInboundRecipient(recipient)?.aliasToken ?? null;
}

export function inboundPayload(
  message: ForwardableEmailMessage,
  email: Email,
  token: string,
  raw?: ArrayBuffer,
): Record<string, unknown> {
  const parsedText = String(email.text ?? "").trim() || htmlToText(String(email.html ?? ""));
  const text = googleForwardingControlText(message, email, parsedText, raw);
  const parsedDate = new Date(String(email.date ?? ""));
  return {
    alias_token: token,
    envelope_from: clean(message.from, 320).toLowerCase(),
    envelope_to: clean(message.to, 320).toLowerCase(),
    from: header(email, "from", 500) || mailbox(email.from),
    reply_to: header(email, "reply-to", 500) || (email.replyTo ?? []).map(mailbox).filter(Boolean).join(", "),
    original_to: header(email, "to", 1000),
    subject: clean(email.subject, 500),
    text: text.replace(/\u0000/g, "").slice(0, MAX_BODY_CHARS),
    message_id: messageIds(email.messageId),
    in_reply_to: messageIds(email.inReplyTo),
    references: messageIds(email.references),
    precedence: header(email, "precedence", 80).toLowerCase(),
    auto_submitted: header(email, "auto-submitted", 80).toLowerCase(),
    list_unsubscribe: Boolean(header(email, "list-unsubscribe", 500)),
    received_at: Number.isFinite(parsedDate.getTime()) ? parsedDate.toISOString() : new Date().toISOString(),
    raw_size: message.rawSize,
    attachments: email.attachments.slice(0, MAX_ATTACHMENTS).map((item) => ({
      filename: clean(item.filename, 180),
      mime_type: clean(item.mimeType, 100).toLowerCase(),
      byte_size: attachmentSize(item.content),
    })),
    authentication_results: header(email, "authentication-results", 2000),
  };
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function pemBytes(pem: string, label: string): Uint8Array {
  const encoded = pem.replace(`-----BEGIN ${label}-----`, "").replace(`-----END ${label}-----`, "").replace(/\s+/g, "");
  if (!encoded) throw new Error("inbound signing key is unavailable");
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
}

export async function signPayload(privateKeyPem: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemBytes(privateKeyPem, "PRIVATE KEY"),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  return bytesToHex(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${timestamp}.${body}`)));
}

async function deliver(message: ForwardableEmailMessage, env: Env): Promise<void> {
  if (message.rawSize < 1 || message.rawSize > MAX_RAW_BYTES) {
    message.setReject("Message exceeds CaughtUp's inbound size limit");
    return;
  }
  const token = aliasToken(message.to);
  if (!token) {
    message.setReject("Unknown CaughtUp inbound address");
    return;
  }
  const raw = await new Response(message.raw).arrayBuffer();
  const email = await PostalMime.parse(raw, {
    maxHeadersSize: 256_000,
    maxNestingDepth: 20,
    maxRfc822NestingDepth: 3,
    rfc822Attachments: true,
    attachmentEncoding: "arraybuffer",
  });
  const body = JSON.stringify(inboundPayload(message, email, token, raw));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await signPayload(env.IA_INBOUND_SIGNING_PRIVATE_KEY, timestamp, body);
  const response = await fetch(env.SUPABASE_INGEST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-caughtup-timestamp": timestamp,
      "x-caughtup-signature": signature,
    },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  if (clean(message.from, 320).toLowerCase() === GOOGLE_FORWARDING_SENDER) {
    const result: Record<string, unknown> = await response.clone().json<Record<string, unknown>>()
      .catch(() => ({} as Record<string, unknown>));
    const rawText = new TextDecoder().decode(raw);
    console.log(JSON.stringify({
      kind: "google_forwarding_diagnostic",
      response_status: response.status,
      result: result.verification_received === true
        ? "verification_received"
        : result.google_confirmed === true
        ? "google_confirmed"
        : typeof result.discarded === "string" ? result.discarded : result.error ? "error" : "other",
      subject_marker: /gmail forwarding confirmation/i.test(String(email.subject ?? "")),
      from_marker: header(email, "from", 500).toLowerCase().includes(GOOGLE_FORWARDING_SENDER),
      code_marker: /confirmation\s+code\s*:\s*[0-9]{6,20}/i.test(body),
      url_marker: /https:\/\/(?:mail-settings|mail)\.google\.com\/mail\/vf-/i.test(body),
      html_present: Boolean(email.html),
      text_present: Boolean(email.text),
      raw_has_mail_settings: /mail-settings\.google\.com/i.test(rawText),
      raw_has_mail_google: /mail\.google\.com/i.test(rawText),
      raw_has_vf: /\/mail\/vf-/i.test(rawText),
      raw_has_base64: /content-transfer-encoding:\s*base64/i.test(rawText),
    }));
  }
  if (!response.ok) throw new Error(`inbound_ingest_${response.status}`);
}

export default {
  async email(message, env): Promise<void> {
    await deliver(message, env);
  },
  async fetch(request): Promise<Response> {
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
    return Response.json({ ok: true, service: "caughtup-inbound-email" });
  },
} satisfies ExportedHandler<Env>;
