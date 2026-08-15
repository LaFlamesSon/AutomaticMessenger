import PostalMime, { type Address, type Email } from "postal-mime";

const MAX_RAW_BYTES = 10_000_000;
const MAX_BODY_CHARS = 100_000;
const MAX_ATTACHMENTS = 25;
// Gmail forwarding rejects plus-aliases. Current mailboxes are u{token}@...
const TOKEN_RECIPIENT = /^(?:inbox\+|u)([a-z0-9]{32,96})@inbound\.getcaughtup\.io$/i;

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

function attachmentSize(content: ArrayBuffer | Uint8Array | string): number {
  if (typeof content === "string") return new TextEncoder().encode(content).byteLength;
  return content.byteLength;
}

export function aliasToken(recipient: string): string | null {
  return recipient.trim().toLowerCase().match(TOKEN_RECIPIENT)?.[1] ?? null;
}

export function inboundPayload(message: ForwardableEmailMessage, email: Email, token: string): Record<string, unknown> {
  const text = String(email.text ?? "").trim() || htmlToText(String(email.html ?? ""));
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
  const body = JSON.stringify(inboundPayload(message, email, token));
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
