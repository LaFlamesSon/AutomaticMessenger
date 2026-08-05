import { selectMediaKit, type MediaKitCandidate } from "./policy.ts";

export const OPPORTUNITY_STATUSES = ["new", "saved", "dismissed", "drafted", "contacted", "replied"] as const;
export const RELATIONSHIP_STATUSES = [
  "suggested", "contacted", "worked_with", "want_to_work_with", "dream", "not_interested", "blocked",
] as const;

const FREE_MAIL_DOMAINS = new Set([
  "aol.com", "gmail.com", "googlemail.com", "hotmail.com", "icloud.com", "live.com",
  "outlook.com", "proton.me", "protonmail.com", "yahoo.com", "yandex.com",
]);

function cleanDomainHost(host: string): string | null {
  const normalized = host.trim().toLocaleLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  if (!normalized || normalized.length > 253 || normalized === "localhost" || normalized.endsWith(".localhost")) return null;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized) || normalized.includes(":")) return null;
  const labels = normalized.split(".");
  if (labels.length < 2 || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
  return normalized;
}

export function normalizeOpportunityDomain(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (parsed.username || parsed.password || (parsed.port && parsed.port !== "443")) return null;
    return cleanDomainHost(parsed.hostname);
  } catch { return null; }
}

export function normalizeOpportunitySourceUrl(value: unknown, expectedDomain?: string | null): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 1000) return null;
  try {
    const parsed = new URL(value.trim());
    const domain = cleanDomainHost(parsed.hostname);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || (parsed.port && parsed.port !== "443") || !domain) return null;
    if (expectedDomain && domain !== expectedDomain && !domain.endsWith(`.${expectedDomain}`)) return null;
    parsed.hash = "";
    return parsed.toString();
  } catch { return null; }
}

export function senderBusinessDomain(sender: unknown): string | null {
  if (typeof sender !== "string") return null;
  const email = sender.match(/<?([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@([a-z0-9.-]+))>?/i);
  const domain = email ? cleanDomainHost(email[2]) : null;
  return domain && !FREE_MAIL_DOMAINS.has(domain) ? domain : null;
}

function normalizedText(values: unknown[]): string {
  return values.flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value): value is string => typeof value === "string")
    .join(" ").toLocaleLowerCase();
}

function overlaps(values: unknown, haystack: string): string[] {
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is string => typeof value === "string")
    .map((value) => value.trim()).filter((value) => value.length >= 2 && haystack.includes(value.toLocaleLowerCase()));
}

function normalizedList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().toLocaleLowerCase()).filter(Boolean);
}

export interface OpportunityMatchInput {
  brand_name: string;
  brand_domain: string;
  title?: string;
  description?: string;
  tags?: string[];
  relationship_status?: string | null;
}

export function matchOpportunity(
  preferences: Record<string, unknown> | null,
  kits: MediaKitCandidate[],
  opportunity: OpportunityMatchInput,
): { score: number; reasons: string[]; recommendedKit: MediaKitCandidate | null; excluded: boolean } {
  const brand = opportunity.brand_name.trim();
  const domain = opportunity.brand_domain.trim().toLocaleLowerCase();
  const normalizedBrand = brand.toLocaleLowerCase();
  const excluded = normalizedList(preferences?.excluded_brands).some((entry) => {
    const excludedDomain = normalizeOpportunityDomain(entry);
    return excludedDomain ? domain === excludedDomain : normalizedBrand === entry;
  });
  if (excluded || ["blocked", "not_interested"].includes(opportunity.relationship_status ?? "")) {
    return { score: 0, reasons: ["Excluded by the creator's saved preferences"], recommendedKit: null, excluded: true };
  }

  const searchText = normalizedText([
    brand, domain, opportunity.title ?? "", opportunity.description ?? "", opportunity.tags ?? [],
  ]);
  const reasons: string[] = [];
  let score = 10;
  const desired = overlaps(preferences?.desired_brands, searchText);
  if (desired.length) { score += 25; reasons.push(`Matches desired brand: ${desired[0]}`); }
  const industries = overlaps(preferences?.industries, searchText);
  if (industries.length) { score += Math.min(30, industries.length * 15); reasons.push(`Industry fit: ${industries.slice(0, 2).join(", ")}`); }
  const styles = overlaps(preferences?.creator_styles, searchText);
  if (styles.length) { score += Math.min(15, styles.length * 8); reasons.push(`Creator style fit: ${styles.slice(0, 2).join(", ")}`); }
  const collaborationTypes = overlaps(preferences?.collaboration_types, searchText);
  if (collaborationTypes.length) { score += 15; reasons.push(`Collaboration fit: ${collaborationTypes.slice(0, 2).join(", ")}`); }
  const platforms = overlaps(preferences?.platforms, searchText);
  if (platforms.length) { score += 10; reasons.push(`Platform fit: ${platforms.slice(0, 2).join(", ")}`); }
  if (["worked_with", "contacted", "want_to_work_with", "dream"].includes(opportunity.relationship_status ?? "")) {
    score += opportunity.relationship_status === "worked_with" ? 20 : 12;
    reasons.push(`Relationship: ${(opportunity.relationship_status ?? "").replaceAll("_", " ")}`);
  }

  const recommendedKit = selectMediaKit(
    kits,
    `opportunity@${domain}`,
    `${brand} creator collaboration`,
    `${opportunity.title ?? ""} ${opportunity.description ?? ""} ${(opportunity.tags ?? []).join(" ")} media kit partnership`,
  );
  if (recommendedKit) {
    score += recommendedKit.match_strength === "default" ? 5 : 15;
    reasons.push(recommendedKit.match_strength === "default"
      ? `General media kit fallback: ${recommendedKit.label}`
      : `Media kit fit: ${recommendedKit.label}`);
  }
  if (!reasons.length) reasons.push("Brand was added by the creator; more profile detail will improve this match");
  return { score: Math.min(100, score), reasons, recommendedKit, excluded: false };
}
