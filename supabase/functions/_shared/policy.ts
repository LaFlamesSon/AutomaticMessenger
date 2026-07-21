export const CATEGORIES = [
  "urgent", "action_needed", "fyi", "low_priority", "spam_or_poor_fit",
] as const;

export type Category = typeof CATEGORIES[number];

export interface MediaKitCandidate {
  id: string;
  label: string;
  sender_domains?: string[];
  brand_names?: string[];
  keywords?: string[];
  is_default?: boolean;
  auto_attach?: boolean;
  match_strength?: "exact_domain" | "exact_brand" | "keyword" | "default";
  auto_send_eligible?: boolean;
}

const HARD_DRAFT_PATTERNS: [string, RegExp][] = [
  ["price", /(?:\$|€|£)\s?\d|\b(?:my|our|the)\s+(?:price|cost|rate|fee)\s+(?:is|will be|would be|would come to)\b/i],
  ["availability", /\b(?:i am|i'm|we are|we're)\s+available\b|\b(?:i|we)\s+can\s+(?:start|begin)\b/i],
  ["turnaround", /\b(?:i|we)\s+(?:will|can)\s+deliver\b|\b(?:turnaround|deliver(?:y)?\s+(?:in|within)|ready\s+(?:in|by))\b/i],
  ["acceptance", /\b(?:i|we)\s+(?:accept|decline)\b|\b(?:i|we)\s+(?:would\s+be\s+happy|am\s+happy|are\s+happy|would\s+be\s+glad)\s+to\s+(?:take|work|accept|move\s+forward)\b|\b(?:i|we)(?:'m|\s+am|\s+are)\s+not\s+interested\b|\b(?:i|we)(?:'ll|\s+will)\s+pass\s+on\b|\b(?:offer|proposal)\s+(?:is\s+)?accepted\b/i],
];

export function normalizedStringList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) throw new Error("must be an array");
  if (value.length > maxItems) throw new Error(`must contain at most ${maxItems} items`);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") throw new Error("items must be strings");
    const item = raw.trim().replace(/\s+/g, " ");
    if (!item || item.length > maxLength) throw new Error(`items must be 1-${maxLength} characters`);
    const key = item.toLocaleLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(item); }
  }
  return out;
}

export function draftSafetyViolations(draft: string): string[] {
  return HARD_DRAFT_PATTERNS.filter(([, pattern]) => pattern.test(draft)).map(([name]) => name);
}

export function finalizePortfolioDraft(draft: string, hasAttachments: boolean): string {
  if (hasAttachments) return /\b(?:attach(?:ed|ment)|enclos(?:ed|ure))\b/i.test(draft)
    ? draft : `${draft.trim()}\n\nI've attached relevant samples.`;
  return draft.replace(/\b(?:i(?:'ve| have)?\s+)?(?:attached|enclosed)\s+(?:a few\s+)?(?:relevant\s+)?(?:samples|examples|files)\b[.!]?/gi,
    "I can share relevant samples.");
}

export function deliveryDecision(input: {
  category: Category;
  draft: string | null;
  missingRequired?: string[];
  profile: Record<string, unknown>;
  selectedKit?: MediaKitCandidate | null;
  wantsPortfolio?: boolean;
  confidence?: number;
}): "none" | "draft" | "auto_send" {
  if (!input.draft) return "none";
  if ((input.draft.trim().match(/\S+/g) ?? []).length > 150) return "none";
  const draftCategories = Array.isArray(input.profile.draft_categories)
    ? input.profile.draft_categories as string[] : ["urgent", "action_needed"];
  if (!draftCategories.includes(input.category)) return "none";
  if (draftSafetyViolations(input.draft).length) return "none";
  const confirmed = input.profile.reply_mode === "auto_send" && input.profile.auto_send === true &&
    typeof input.profile.auto_send_confirmed_at === "string" && input.profile.auto_send_policy_version === "v1";
  if (!confirmed) return "draft";
  const autoCategories = Array.isArray(input.profile.auto_send_categories)
    ? input.profile.auto_send_categories as string[] : [];
  if (!autoCategories.includes(input.category)) return "draft";
  if ((input.missingRequired ?? []).length) return "draft";
  if (typeof input.profile.custom_rules === "string" && input.profile.custom_rules.trim()) return "draft";
  if (typeof input.confidence !== "number" || !Number.isFinite(input.confidence) || input.confidence < 0.9) return "draft";
  if (input.wantsPortfolio && (!input.selectedKit || input.selectedKit.auto_attach !== true ||
    input.selectedKit.auto_send_eligible !== true)) return "draft";
  return "auto_send";
}

function includesTerm(haystack: string, term: string): boolean {
  const needle = term.trim().toLocaleLowerCase();
  if (needle.length < 2) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "iu").test(haystack);
}

export function selectMediaKit(kits: MediaKitCandidate[], senderEmail: string, subject: string, body: string): MediaKitCandidate | null {
  const domain = senderEmail.split("@")[1]?.toLocaleLowerCase() ?? "";
  const text = `${subject}\n${body}`.toLocaleLowerCase();
  const scored = kits.map((kit) => {
    let score = 0;
    let strength: MediaKitCandidate["match_strength"];
    if ((kit.sender_domains ?? []).some((d) => d.trim().toLocaleLowerCase() === domain)) { score = 300; strength = "exact_domain"; }
    else if ((kit.brand_names ?? []).some((term) => includesTerm(text, term))) { score = 200; strength = "exact_brand"; }
    else if ((kit.keywords ?? []).some((term) => includesTerm(text, term))) { score = 100; strength = "keyword"; }
    return { kit, score, strength };
  }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score);
  if (scored.length && (scored.length === 1 || scored[0].score > scored[1].score)) {
    return { ...scored[0].kit, match_strength: scored[0].strength,
      // Content is untrusted: brand/keyword mentions may suggest a Review draft,
      // but only an exact configured sender-domain rule may release an attachment unattended.
      auto_send_eligible: scored[0].strength === "exact_domain" };
  }
  if (scored.length) return null;
  const defaults = kits.filter((kit) => kit.is_default === true);
  return defaults.length === 1 ? { ...defaults[0], match_strength: "default", auto_send_eligible: false } : null;
}

export function localScheduleWindow(now: Date, timezone: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}
