export const CATEGORIES = [
  "urgent", "action_needed", "fyi", "low_priority", "spam_or_poor_fit",
] as const;

export type Category = typeof CATEGORIES[number];

export interface MediaKitCandidate {
  id: string;
  label: string;
  description?: string | null;
  sender_domains?: string[];
  brand_names?: string[];
  keywords?: string[];
  is_default?: boolean;
  auto_attach?: boolean;
  match_strength?: "exact_domain" | "exact_brand" | "keyword" | "description" | "default";
  auto_send_eligible?: boolean;
}

export interface WeeklyAvailabilityEntry { day: number; start: string; end: string }
export interface CalendarPreference {
  contact_mode: "email_only" | "scheduled_call" | "phone";
  phone_number?: string | null;
  booking_url?: string | null;
  timezone: string;
  weekly_availability: WeeklyAvailabilityEntry[];
}
export interface VerifiedOpenSlot { start_at: string; end_at: string; label: string }

export interface DraftIdentity {
  display_name?: string | null;
  signoff?: string | null;
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

const STYLE_PREFERENCE_INTENT = /\b(?:make|write|use|keep|change|set|prefer|sound|communicate|remember)\b[^.!?\n]{0,120}\b(?:repl(?:y|ies)|drafts?|emails?|messages?|tone|style|voice|writing|communication|communicate)\b|\b(?:repl(?:y|ies)|drafts?|emails?|messages?|tone|style|voice|writing|communication)\b[^.!?\n]{0,120}\b(?:concise|brief|warm|friendly|formal|casual|professional|direct|playful|short)\b|\b(?:i|we)\s+(?:usually|normally|prefer\s+to|like\s+to)?\s*(?:write|communicate|sound)\b[^.!?\n]{0,100}\b(?:concise|brief|warm|friendly|formal|casual|professional|direct|playful|short)\b/i;
const UNSAFE_STYLE_PREFERENCE = /\b(?:auto[- ]?send|bypass|override|ignore\s+(?:safety|rules?)|accept|decline|price|rate|availability|turnaround)\b/i;

export function explicitStylePreference(message: string): string | null {
  const normalized = message.trim().replace(/\s+/g, " ").slice(0, 500);
  if (!normalized || /^(?:why|what|how|when|where|did|was|were)\b/i.test(normalized) ||
    !STYLE_PREFERENCE_INTENT.test(normalized) || UNSAFE_STYLE_PREFERENCE.test(normalized)) return null;
  return normalized;
}

export function draftSafetyViolations(draft: string): string[] {
  return HARD_DRAFT_PATTERNS.filter(([, pattern]) => pattern.test(draft)).map(([name]) => name);
}

const PORTFOLIO_NOUN = String.raw`(?:media\s+kit|portfolio|work\s+(?:samples?|examples?)|relevant\s+samples?|samples?|examples?|example\s+(?:images?|work)|case\s+stud(?:y|ies))`;
const PORTFOLIO_REQUEST = new RegExp(
  String.raw`(?:\b(?:attach|send|share|include|provide|review|see|need(?:s|ed)?|want(?:s|ed)?|request(?:s|ed)?|looking\s+for)\b[^.!?\n]{0,100}\b${PORTFOLIO_NOUN}\b|\b${PORTFOLIO_NOUN}\b[^.!?\n]{0,100}\b(?:attach|send|share|include|provide|review|see|need(?:s|ed)?|want(?:s|ed)?|request(?:s|ed)?|looking\s+for)\b)`,
  "iu",
);
const WORK_SIGNAL = /\b(?:sponsor(?:ship|ed)?|paid\s+(?:creator\s+)?(?:partnership|collaboration)|creator\s+(?:partnership|campaign)|brand\s+(?:partnership|campaign|collaboration)|campaign|collab(?:oration)?|partnership|project|(?:campaign|creative|project)\s+brief|full\s+brief|deliverables?|brand\s+(?:assets?|materials?|guidelines?)|media\s+kit|portfolio|work\s+(?:samples?|examples?))\b/i;
const COLLABORATION_SIGNAL = /\b(?:sponsor(?:ship|ed)?|paid\s+(?:creator\s+)?(?:partnership|collaboration)|creator\s+(?:partnership|campaign)|brand\s+(?:partnership|campaign|collaboration)|campaign|collab(?:oration)?|partnership)\b/i;
const REQUEST_SIGNAL = /\?|(?:\b(?:could|can|would)\s+you\b)|(?:\bplease\b)|(?:\b(?:send|share|attach|include|provide|reply|respond|discuss|schedule|book)\b)|(?:\b(?:interested\s+in|looking\s+for)\b)/i;
const EXPLICIT_NO_REPLY = /\b(?:fyi\s+only|for\s+(?:awareness|information|your\s+records)\s+only|no\s+(?:reply|response|action)\s+(?:is\s+)?(?:needed|required)|(?:please\s+)?do\s+not\s+reply)\b/i;
const HOSTILE_INBOUND = /\b(?:ignore|bypass|override|disregard)\b[^.!?\n]{0,80}\b(?:instructions?|rules?|safety|approval|policy|policies|prompts?|settings?|preferences?|configuration)\b|\b(?:system|developer)\s*(?:message|instruction)?\s*:|\b(?:email|these?)\s+instructions?\b[^.!?\n]{0,80}\b(?:outrank|override|replace)\b|\b(?:turn|enable)\b[^.!?\n]{0,40}\bauto[- ]?send\b|\b(?:correct\s+response|reply\s+saying|response\s+is\s+exactly)\b|\b(?:reveal|print|send|share)\b[^.!?\n]{0,80}\b(?:hidden\s+prompt|password|credential|access\s+token|refresh\s+token|secret)\b|\b(?:private|stored)\b[^.!?\n]{0,40}\b(?:phone\s+number|contact\s+details|data|files?)\b|\bguaranteed\b[^.!?\n]{0,80}\b(?:followers?|returns?|engagement)\b|\b(?:buy|purchase)\s+(?:verified\s+)?followers?\b|\b(?:deposit|processing\s+fee)\b[^.!?\n]{0,80}\b(?:before|to\s+claim)\b/i;

export function explicitPortfolioRequest(subject: string, body: string): boolean {
  return PORTFOLIO_REQUEST.test(`${subject}\n${body}`);
}

export function hostileInboundDetected(subject: string, body: string): boolean {
  return HOSTILE_INBOUND.test(`${subject}\n${body}`);
}

export function legitimateInquiryFallbackAllowed(subject: string, body: string): boolean {
  const text = `${subject}\n${body}`;
  return !hostileInboundDetected(subject, body) && !EXPLICIT_NO_REPLY.test(text) &&
    (explicitPortfolioRequest(subject, body) || (WORK_SIGNAL.test(text) && REQUEST_SIGNAL.test(text)));
}

export function collaborationMediaKitRelevant(subject: string, body: string): boolean {
  const text = `${subject}\n${body}`;
  return legitimateInquiryFallbackAllowed(subject, body) && COLLABORATION_SIGNAL.test(text);
}

export function safeNegotiationDraft(identity: DraftIdentity): string {
  return enforceConfiguredSignoff(
    "Thanks for sending the terms. Could you confirm the timeline and any usage or exclusivity expectations so I can review the full scope?",
    identity,
  );
}

export function safeInformationDraft(identity: DraftIdentity, wantsPortfolio = false): string {
  const portfolio = wantsPortfolio ? "\n\nI can share relevant samples for review." : "";
  return enforceConfiguredSignoff(
    `Thanks for reaching out.\n\nCould you share more about the project scope, goals, timeline, and any brand materials you already have?${portfolio}`,
    identity,
  );
}

export function enforceConfiguredSignoff(draft: string, identity: DraftIdentity): string {
  const signoff = String(identity.signoff ?? "Best").trim().replace(/\s+/g, " ").slice(0, 100) || "Best";
  const name = String(identity.display_name ?? "").trim().replace(/\s+/g, " ").slice(0, 100);
  const withoutExisting = draft.trim().replace(
    /\n{1,3}(?:best|thanks|thank you|sincerely|regards|warmly|cheers|kind regards|talk soon|speak soon|take care|all the best|looking forward|warm regards)[,!]?\s*(?:\n+\s*)?[^\n]{0,100}\s*$/i,
    "",
  ).trim();
  return `${withoutExisting}\n\n${signoff},${name ? `\n${name}` : ""}`.trim();
}

export function finalizePortfolioDraft(draft: string, hasAttachments: boolean): string {
  if (hasAttachments) {
    if (/\b(?:attach(?:ed|ment)|enclos(?:ed|ure))\b/i.test(draft)) return draft;
    const signoff = draft.match(/(?:^|\n)(?:best|thanks|thank you|sincerely|regards|warmly|cheers|kind regards)[,!]?\s*(?:\n|$)/i);
    if (!signoff || signoff.index === undefined) return `${draft.trim()}\n\nI've attached relevant samples.`;
    const position = signoff.index + (signoff[0].startsWith("\n") ? 1 : 0);
    return `${draft.slice(0, position).trimEnd()}\n\nI've attached relevant samples.\n\n${draft.slice(position).trimStart()}`.trim();
  }
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
  // Configured questions are information to gather, not four prerequisites that
  // must all be answered before a safe reply can be sent. Deterministic recovery
  // marks its output for human review explicitly and must remain Review-only.
  if ((input.missingRequired ?? []).some((item) => item.trim().toLocaleLowerCase() === "manual review")) return "draft";
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

const DESCRIPTION_STOP_WORDS = new Set([
  "about", "all", "also", "and", "any", "are", "attach", "attachment", "best", "brand", "campaign", "can",
  "business", "care", "collab", "collaboration", "content", "creator", "default", "design", "education", "example", "file",
  "for", "from", "general", "has", "have", "include", "information", "into", "its", "kit", "media", "new", "not", "our", "partnership",
  "platform", "portfolio", "product", "provide", "relevant", "request", "review", "sample", "send", "service", "share",
  "sponsor", "sponsorship", "that", "the", "their", "this", "use", "who", "with", "work", "you", "your",
]);

function relevanceToken(raw: string): string {
  let token = raw.toLocaleLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");
  if (token.length > 5 && /ies$/.test(token)) token = `${token.slice(0, -3)}y`;
  else if (token.length > 5 && /(?:ches|shes|xes|zes)$/.test(token)) token = token.slice(0, -2);
  else if (token.length > 3 && /s$/.test(token) && !/ss$/.test(token)) token = token.slice(0, -1);
  return token;
}

function relevanceTokens(value: string): Set<string> {
  const tokens = value.match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(tokens.map(relevanceToken)
    .filter((token) => token.length >= 3 && !DESCRIPTION_STOP_WORDS.has(token)));
}

function descriptionMatchCount(description: string | null | undefined, emailText: string): number {
  if (!description?.trim()) return 0;
  const descriptionTokens = relevanceTokens(description.slice(0, 500));
  const emailTokens = relevanceTokens(emailText);
  let matches = 0;
  for (const token of descriptionTokens) {
    if (emailTokens.has(token)) matches += 2;
    if (token.length >= 4 && Array.from(emailTokens).some((emailToken) => {
      if (emailToken === token || emailToken.length < 4) return false;
      const shorter = Math.min(token.length, emailToken.length);
      const longer = Math.max(token.length, emailToken.length);
      return shorter / longer >= 0.5 &&
        (token.startsWith(emailToken) || emailToken.startsWith(token));
    })) matches++;
  }
  return matches;
}

const EXPLICITLY_BROAD_KIT_REQUEST = /\b(?:general|broad|mixed|multiple|several|various)\s+(?:beauty|media\s+kit|kit|product(?:s)?|categor(?:y|ies)|industr(?:y|ies)|vertical(?:s)?|collaboration|campaign)\b|\bno\s+(?:single|specific|clear)\s+(?:specialty|category|fit|focus)\b/i;

export function selectMediaKit(kits: MediaKitCandidate[], senderEmail: string, subject: string, body: string): MediaKitCandidate | null {
  const domain = senderEmail.split("@")[1]?.toLocaleLowerCase() ?? "";
  const text = `${subject}\n${body}`.toLocaleLowerCase();
  const defaultKit = () => {
    const defaults = kits.filter((kit) => kit.is_default === true);
    return defaults.length === 1
      ? { ...defaults[0], match_strength: "default" as const, auto_send_eligible: defaults[0].auto_attach === true }
      : null;
  };
  const scored = kits.map((kit) => {
    let score = 0;
    let strength: MediaKitCandidate["match_strength"];
    if ((kit.sender_domains ?? []).some((d) => d.trim().toLocaleLowerCase() === domain)) { score = 300; strength = "exact_domain"; }
    else if ((kit.brand_names ?? []).some((term) => includesTerm(text, term))) { score = 200; strength = "exact_brand"; }
    else if ((kit.keywords ?? []).some((term) => includesTerm(text, term))) { score = 100; strength = "keyword"; }
    else {
      const matches = descriptionMatchCount(kit.description, text);
      if (matches > 0) { score = 50 + Math.min(matches, 4) * 10; strength = "description"; }
    }
    return { kit, score, strength };
  }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score);
  if (scored.length && (scored.length === 1 || scored[0].score > scored[1].score)) {
    if (EXPLICITLY_BROAD_KIT_REQUEST.test(text) &&
      scored[0].strength !== "exact_domain" && scored[0].strength !== "exact_brand") return defaultKit();
    return { ...scored[0].kit, match_strength: scored[0].strength,
      // The owner-controlled Auto-attach toggle authorizes a uniquely matched
      // kit for otherwise safe Auto-send replies. Ambiguous matches already
      // fall back rather than guessing between private files.
      auto_send_eligible: scored[0].kit.auto_attach === true };
  }
  return defaultKit();
}

const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const EXTERNAL_CALENDAR_CLAIM = /\bcalendar\b|\bsynchroni[sz](?:e|ed|ation)\b|\b(?:no|not\s+be\s+a)\s+(?:calendar\s+)?conflicts?\b|\bconflict(?:s|[- ]free|\s+with\s+other\s+events)\b/i;
const CONTACT_LINE = /\b(?:call|phone|schedule|scheduling|book|booking|meeting|meet|reach me|zoom|video\s+conference|video\s+call|live\s+chat|chat\s+live|hop\s+on|jump\s+on)\b|\bwhat\s+time\s+works\b|\b(?:a\s+)?good\s+time\s+to\s+(?:connect|chat|talk)\b|\btime\s+to\s+(?:connect|chat|talk)\b|\blet(?:'|\s+u)s\s+(?:connect|chat|talk)\b|\b(?:connect|chat|talk)\s+(?:next|this|on|at|live)\b|\b(?:can|could)\s+we\s+(?:speak|talk)\b|\bdiscuss\b[^.!?]*\bverbally\b|\bsend\s+me\s+times?\b|\bare\s+you\s+free\b|\bwould\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\b[^.!?]*\bsuit\s+you\b|\bwould\s+(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|today|tomorrow)\b[^.!?]*\bwork\s+for\s+you\b|https?:\/\/|(?:\+?\d[\d\s().-]{7,}\d)/i;

export function normalizeWeeklyAvailability(value: unknown): WeeklyAvailabilityEntry[] {
  if (!Array.isArray(value) || value.length > 7) throw new Error("weekly_availability must contain at most one window per day");
  const entries = value.map((raw: any) => {
    const day = Number(raw?.day);
    const start = String(raw?.start ?? "");
    const end = String(raw?.end ?? "");
    if (!Number.isInteger(day) || day < 0 || day > 6 || !CLOCK.test(start) || !CLOCK.test(end) || start >= end) {
      throw new Error("availability windows require day 0-6 and increasing HH:MM times");
    }
    return { day, start, end };
  }).sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
  for (let i = 1; i < entries.length; i++) {
    if (entries[i - 1].day === entries[i].day) {
      throw new Error("weekly_availability supports one window per day");
    }
  }
  return entries;
}

export function safeCalendarPreference(value: any, fallbackTimezone = "America/Los_Angeles"): CalendarPreference {
  const fallback: CalendarPreference = { contact_mode: "email_only", phone_number: null,
    booking_url: null, timezone: fallbackTimezone, weekly_availability: [] };
  try {
    const contact_mode = ["email_only", "scheduled_call", "phone"].includes(value?.contact_mode)
      ? value.contact_mode as CalendarPreference["contact_mode"] : "email_only";
    const phone_number = typeof value?.phone_number === "string" && /^\+[1-9]\d{7,14}$/.test(value.phone_number)
      ? value.phone_number : null;
    let booking_url: string | null = null;
    if (typeof value?.booking_url === "string" && value.booking_url) {
      const parsed = new URL(value.booking_url);
      if (parsed.protocol === "https:" && !parsed.username && !parsed.password) booking_url = parsed.toString();
    }
    const timezone = typeof value?.timezone === "string" ? value.timezone : fallbackTimezone;
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    const weekly_availability = normalizeWeeklyAvailability(value?.weekly_availability ?? []);
    if (contact_mode === "phone" && !phone_number) return fallback;
    if (contact_mode === "scheduled_call" && !booking_url && !weekly_availability.length) return fallback;
    return { contact_mode, phone_number, booking_url, timezone, weekly_availability };
  } catch { return fallback; }
}

function zonedParts(date: Date, timezone: string): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function zonedLocalToUtc(localDate: string, time: string, timezone: string): Date | null {
  const [year, month, day] = localDate.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const actual = zonedParts(new Date(guess), timezone);
    const represented = Date.UTC(Number(actual.year), Number(actual.month) - 1, Number(actual.day), Number(actual.hour), Number(actual.minute));
    guess += wanted - represented;
  }
  const candidate = new Date(guess);
  const matches = (date: Date) => {
    const actual = zonedParts(date, timezone);
    return `${actual.year}-${actual.month}-${actual.day}T${actual.hour}:${actual.minute}` === `${localDate}T${time}`;
  };
  if (!matches(candidate) || matches(new Date(guess - 60 * 60_000)) || matches(new Date(guess + 60 * 60_000))) return null;
  return candidate;
}

function localDate(date: Date, timezone: string): string {
  const part = zonedParts(date, timezone);
  return `${part.year}-${part.month}-${part.day}`;
}

function datePlusDays(local: string, days: number): string {
  const [year, month, day] = local.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function bookingWithinAvailability(start: Date, end: Date, timezone: string, availability: WeeklyAvailabilityEntry[]): boolean {
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return false;
  const startParts = zonedParts(start, timezone);
  const endParts = zonedParts(end, timezone);
  if (`${startParts.year}-${startParts.month}-${startParts.day}` !== `${endParts.year}-${endParts.month}-${endParts.day}`) return false;
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(startParts.weekday);
  const startClock = `${startParts.hour}:${startParts.minute}`;
  const endClock = `${endParts.hour}:${endParts.minute}`;
  return availability.some((window) => window.day === day && window.start <= startClock && window.end >= endClock);
}

export function findVerifiedOpenSlots(
  preference: CalendarPreference,
  bookings: { start_at: string; end_at: string }[],
  now = new Date(),
  limit = 3,
): VerifiedOpenSlot[] {
  if (preference.contact_mode !== "scheduled_call" || preference.booking_url) return [];
  const availability = normalizeWeeklyAvailability(preference.weekly_availability);
  const busy = bookings.map((booking) => [new Date(booking.start_at).getTime(), new Date(booking.end_at).getTime()]);
  const baseDate = localDate(now, preference.timezone);
  const output: VerifiedOpenSlot[] = [];
  for (let offset = 0; offset < 14 && output.length < limit; offset++) {
    const date = datePlusDays(baseDate, offset);
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    for (const window of availability.filter((entry) => entry.day === day)) {
      const startMinutes = Number(window.start.slice(0, 2)) * 60 + Number(window.start.slice(3));
      const endMinutes = Number(window.end.slice(0, 2)) * 60 + Number(window.end.slice(3));
      for (let minute = startMinutes; minute + 30 <= endMinutes && output.length < limit; minute += 30) {
        const clock = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
        const endClockMinute = minute + 30;
        const endClock = `${String(Math.floor(endClockMinute / 60)).padStart(2, "0")}:${String(endClockMinute % 60).padStart(2, "0")}`;
        const start = zonedLocalToUtc(date, clock, preference.timezone);
        const end = zonedLocalToUtc(date, endClock, preference.timezone);
        if (!start || !end || end <= start) continue;
        if (start.getTime() < now.getTime() + 5 * 60_000 || busy.some(([a, b]) => start.getTime() < b && end.getTime() > a)) continue;
        const label = new Intl.DateTimeFormat("en-US", { timeZone: preference.timezone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(start);
        output.push({ start_at: start.toISOString(), end_at: end.toISOString(), label });
      }
    }
  }
  return output;
}

export function applyContactPreference(draft: string, preference: CalendarPreference, slots: VerifiedOpenSlot[]): string {
  const base = draft.replace(/\r\n/g, "\n").split("\n").map((line) => {
    // A sentence boundary requires whitespace or end-of-line after punctuation.
    // This keeps dots inside URLs intact so the server-owned booking suffix is
    // removed and re-applied exactly during its idempotency safety check.
    const sentences = line.match(/.*?(?:[.!?]+(?=\s|$)|$)/g) ?? [];
    return sentences.map((sentence) => sentence.trim()).filter((sentence) => sentence &&
      !CONTACT_LINE.test(sentence) && !EXTERNAL_CALENDAR_CLAIM.test(sentence)).join(" ");
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  let contact = "";
  if (preference.contact_mode === "phone" && preference.phone_number) contact = `You can reach me at ${preference.phone_number}.`;
  if (preference.contact_mode === "scheduled_call" && preference.booking_url) contact = `You can choose a call time here: ${preference.booking_url}`;
  if (preference.contact_mode === "scheduled_call" && !preference.booking_url && slots.length) {
    // Keep the server-owned suffix one sentence so applying the policy again is idempotent.
    contact = `I can offer a 30-minute call at ${slots.map((slot) => slot.label).join(" or ")}; let me know which works.`;
  }
  if (!contact) return base;
  const signoff = base.match(/(?:^|\n)(?:best|thanks|thank you|sincerely|regards|warmly|cheers|kind regards)[,!]?\s*(?:\n|$)/i);
  if (!signoff || signoff.index === undefined) return `${base}\n\n${contact}`.trim();
  const position = signoff.index + (signoff[0].startsWith("\n") ? 1 : 0);
  return `${base.slice(0, position).trimEnd()}\n\n${contact}\n\n${base.slice(position).trimStart()}`.trim();
}

export function contactSafetyViolations(draft: string, preference: CalendarPreference, slots: VerifiedOpenSlot[]): string[] {
  const violations: string[] = [];
  if (/\b(?:confirmed|booked|reserved|locked\s+in)\b/i.test(draft)) violations.push("booking_confirmation");
  if (EXTERNAL_CALENDAR_CLAIM.test(draft)) violations.push("external_calendar_claim");
  const expected = applyContactPreference(draft, preference, slots);
  if (draft !== expected) violations.push("unverified_contact_method");
  return violations;
}

export function localScheduleWindow(now: Date, timezone: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}
