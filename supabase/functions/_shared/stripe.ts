export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

export interface StripeSignatureParts {
  timestamp: number;
  signatures: string[];
}

export function parseStripeSignature(header: string): StripeSignatureParts | null {
  let timestamp = Number.NaN;
  const signatures: string[] = [];
  for (const item of String(header ?? "").split(",")) {
    const separator = item.indexOf("=");
    if (separator < 1) continue;
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (key === "t" && /^\d+$/.test(value)) timestamp = Number(value);
    if (key === "v1" && /^[0-9a-f]{64}$/i.test(value)) signatures.push(value.toLowerCase());
  }
  return Number.isSafeInteger(timestamp) && timestamp > 0 && signatures.length
    ? { timestamp, signatures }
    : null;
}

export function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function stripeSignature(
  payload: string,
  timestamp: number,
  secret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`),
  );
  return Array.from(new Uint8Array(mac), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const parsed = parseStripeSignature(header);
  if (!parsed || !secret || Math.abs(nowSeconds - parsed.timestamp) > STRIPE_SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }
  const expected = await stripeSignature(payload, parsed.timestamp, secret);
  return parsed.signatures.some((signature) => constantTimeEqual(expected, signature));
}

export const STRIPE_SUBSCRIPTION_STATUSES = new Set([
  "incomplete", "incomplete_expired", "trialing", "active", "past_due",
  "unpaid", "paused", "canceled",
]);

export function normalizedSubscriptionStatus(value: unknown): string {
  const status = typeof value === "string" ? value : "";
  return STRIPE_SUBSCRIPTION_STATUSES.has(status) ? status : "incomplete";
}

export function subscriptionHasAccess(status: unknown): boolean {
  return status === "active" || status === "trialing";
}

export function stripeUnixTimestamp(value: unknown): string | null {
  const seconds = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function stripeIdentifier(value: unknown, prefix: string): string | null {
  const id = typeof value === "string" ? value : "";
  return new RegExp(`^${prefix}_[A-Za-z0-9_]{6,255}$`).test(id) ? id : null;
}

export function stripeHostedUrl(value: unknown, host: "checkout.stripe.com" | "billing.stripe.com"): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === host && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
