export interface CommercialTerms {
  detected: boolean;
  counteroffer: boolean;
  currency: string | null;
  flat_fee_amount: number | null;
  commission_rate: number | null;
  deliverables: string[];
  usage_rights: boolean;
  exclusivity: boolean;
  deadline: boolean;
  signals: string[];
}

export interface MediaKitRateProfile {
  currency?: string | null;
  flat_fee_floor?: number | null;
  flat_fee_target?: number | null;
  commission_floor?: number | null;
  commission_target?: number | null;
  hybrid_guarantee_floor?: number | null;
}

export type ThresholdStatus = "below_minimum" | "within_range" | "at_or_above_target" |
  "insufficient_evidence" | "unconfigured";

const COMMERCIAL = /\b(?:offer|budget|rate|fee|paid|pay(?:ment)?|compensation|commission|counter[ -]?offer|usage rights?|licen[cs](?:e|ing)|exclusiv(?:e|ity)|whitelisting|deliverables?)\b/i;
const COUNTER = /\b(?:counter[ -]?offer|countering|revised offer|instead|can (?:you|we) do|meet (?:you|us) at)\b/i;
const USAGE = /\b(?:usage rights?|licen[cs](?:e|ing)|paid media|advertising rights?|whitelisting|spark ads?)\b/i;
const EXCLUSIVITY = /\bexclusiv(?:e|ity)\b/i;
const DEADLINE = /\b(?:deadline|due|launch(?:es|ing)?|by (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|within \d+ days?)\b/i;

function finite(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function extractCommercialTerms(subject: string, body: string): CommercialTerms {
  const input = `${subject}\n${body}`.slice(0, 20_000);
  const signals = unique(Array.from(input.matchAll(new RegExp(COMMERCIAL.source, "gi"))).map((match) => match[0].toLocaleLowerCase()));
  const currencyMatch = input.match(/\b(USD|CAD|GBP|EUR|AUD)\b/i);
  const dollar = input.match(/(?:\$|USD\s*)(\d{1,9}(?:,\d{3})*(?:\.\d{1,2})?)/i);
  const writtenAmount = input.match(/\b(?:offer|budget|rate|fee|pay(?:ment)?|compensation)\s+(?:is|of|at|would be|:)?\s*(\d{1,9}(?:,\d{3})*(?:\.\d{1,2})?)\s*(USD|CAD|GBP|EUR|AUD)\b/i);
  const commission = input.match(/(?:commission|affiliate|revenue share)[^\d%]{0,40}(\d{1,3}(?:\.\d{1,4})?)\s*%|\b(\d{1,3}(?:\.\d{1,4})?)\s*%[^\n.]{0,40}(?:commission|affiliate|revenue share)/i);
  const deliverables = unique(Array.from(input.matchAll(/\b(\d{1,2})\s+(videos?|posts?|reels?|stories|shorts?|livestreams?|photos?)\b/gi))
    .map((match) => `${match[1]} ${match[2].toLocaleLowerCase()}`)).slice(0, 10);
  const amount = finite(dollar?.[1] ?? writtenAmount?.[1]);
  const rate = finite(commission?.[1] ?? commission?.[2]);
  return {
    detected: COMMERCIAL.test(input) || amount !== null || rate !== null,
    counteroffer: COUNTER.test(input),
    currency: (currencyMatch?.[1] ?? writtenAmount?.[2] ?? (dollar ? "USD" : null))?.toUpperCase() ?? null,
    flat_fee_amount: amount,
    commission_rate: rate !== null && rate >= 0 && rate <= 100 ? rate : null,
    deliverables,
    usage_rights: USAGE.test(input),
    exclusivity: EXCLUSIVITY.test(input),
    deadline: DEADLINE.test(input),
    signals,
  };
}

function number(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function evaluateCommercialTerms(terms: CommercialTerms, profile: MediaKitRateProfile | null): ThresholdStatus {
  if (!profile) return "unconfigured";
  const flatFloor = number(profile.flat_fee_floor);
  const flatTarget = number(profile.flat_fee_target);
  const commissionFloor = number(profile.commission_floor);
  const commissionTarget = number(profile.commission_target);
  const guaranteeFloor = number(profile.hybrid_guarantee_floor);
  const configured = [flatFloor, flatTarget, commissionFloor, commissionTarget, guaranteeFloor].some((value) => value !== null);
  if (!configured) return "unconfigured";

  const assessments: Array<"below" | "within" | "target"> = [];
  if (terms.flat_fee_amount !== null) {
    if ((flatFloor !== null && terms.flat_fee_amount < flatFloor) ||
      (terms.commission_rate !== null && guaranteeFloor !== null && terms.flat_fee_amount < guaranteeFloor)) assessments.push("below");
    else if (flatTarget !== null && terms.flat_fee_amount >= flatTarget) assessments.push("target");
    else assessments.push("within");
  }
  if (terms.commission_rate !== null) {
    if (commissionFloor !== null && terms.commission_rate < commissionFloor) assessments.push("below");
    else if (commissionTarget !== null && terms.commission_rate >= commissionTarget) assessments.push("target");
    else assessments.push("within");
  }
  if (!assessments.length) return "insufficient_evidence";
  if (assessments.includes("below")) return "below_minimum";
  if (assessments.every((value) => value === "target")) return "at_or_above_target";
  return "within_range";
}

export function negotiationStage(hasExisting: boolean, terms: CommercialTerms): "offer_received" | "negotiating" | "countered" {
  if (terms.counteroffer) return "countered";
  return hasExisting ? "negotiating" : "offer_received";
}

export function negotiationEventType(hasExisting: boolean, terms: CommercialTerms): "offer" | "counteroffer" | "terms_update" {
  if (terms.counteroffer) return "counteroffer";
  return hasExisting ? "terms_update" : "offer";
}
