import { asciiEmailCopy, sanitizeHeader } from "./mime.ts";

const ASCII_TEXT = /^[\x20-\x7E]*$/;
const ASCII_BODY = /^[\x20-\x7E\r\n]*$/;

const CATEGORY_LABELS: Record<string, string> = {
  urgent: "URGENT",
  action_needed: "ACTION NEEDED",
  fyi: "FYI",
};

export interface DigestItem {
  category?: string;
  sender?: string;
  subject?: string;
  summary?: string;
  auto_sent?: boolean;
  draft_created?: boolean;
}

function assertAscii(value: string, kind: "subject" | "body"): string {
  const ok = kind === "subject" ? ASCII_TEXT.test(value) : ASCII_BODY.test(value);
  if (!ok) throw new Error(`digest_${kind}_not_ascii`);
  return value;
}

export function composeDigestCopy(input: {
  needsYou: number;
  handled: number;
  items: DigestItem[];
}): { subject: string; body: string } {
  const byCat: Record<string, DigestItem[]> = {};
  for (const row of input.items) (byCat[String(row.category ?? "")] ??= []).push(row);

  const lines: string[] = [
    "Good morning! Here's what your inbox agent did in the last 24 hours.",
    "",
    `${input.needsYou} need you - ${input.handled} handled for you`,
    "",
  ];
  for (const cat of ["urgent", "action_needed", "fyi"]) {
    const items = byCat[cat];
    if (!items?.length) continue;
    lines.push(CATEGORY_LABELS[cat]);
    for (const item of items) {
      const status = item.auto_sent ? " [reply sent]" : item.draft_created ? " [draft ready]" : "";
      const sender = asciiEmailCopy(String(item.sender ?? "").replace(/<.*>/, "")).trim();
      const itemSubject = asciiEmailCopy(item.subject ?? "").trim();
      const summary = asciiEmailCopy(item.summary ?? "").trim();
      lines.push(`  - ${sender} - ${itemSubject}${status}`);
      lines.push(`    ${summary}`);
    }
    lines.push("");
  }
  const noise = (byCat.low_priority?.length ?? 0) + (byCat.spam_or_poor_fit?.length ?? 0);
  if (noise) lines.push(`${noise} newsletters & pitches filtered out for you.`);
  lines.push("", "- CaughtUp, your inbox agent");

  const subject = asciiEmailCopy(input.needsYou
    ? `${input.needsYou} need you, ${input.handled} handled - your CaughtUp digest`
    : `All caught up - ${input.handled} handled for you`, 500);
  const body = asciiEmailCopy(lines.join("\r\n"));
  return {
    subject: assertAscii(subject, "subject"),
    body: assertAscii(body, "body"),
  };
}

function assertRfc822Ascii(rfc822: string): string {
  for (let i = 0; i < rfc822.length; i++) {
    const code = rfc822.charCodeAt(i);
    if (code > 0x7e || (code < 0x20 && code !== 0x0a && code !== 0x0d)) {
      throw new Error("digest_rfc822_not_ascii");
    }
  }
  return rfc822;
}

export function buildDigestRfc822(input: { to: string; subject: string; body: string }): string {
  const subject = sanitizeHeader(asciiEmailCopy(input.subject, 500), 500);
  const body = asciiEmailCopy(input.body);
  if (!ASCII_TEXT.test(subject) || subject.includes("=?UTF-8?")) throw new Error("digest_subject_not_ascii");
  assertAscii(body, "body");
  const rfc822 = [
    `To: ${sanitizeHeader(asciiEmailCopy(input.to, 320), 320)}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="US-ASCII"`,
    `Content-Transfer-Encoding: 7bit`,
    "",
    body,
  ].join("\r\n");
  return assertRfc822Ascii(rfc822);
}

/** Base64url for Gmail `raw`. Rejects non-ASCII instead of UTF-8 encoding it. */
export function encodeDigestRaw(rfc822: string): string {
  assertRfc822Ascii(rfc822);
  return btoa(rfc822).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
