export const TIKTOK_CREATOR_SCOPE = "creator.affiliate_collaboration.read";
const SEARCH_PATH = "/affiliate_creator/202405/open_collaborations/products/search";
const API_ORIGIN = "https://open-api.tiktokglobalshop.com";

type JsonRecord = Record<string, any>;

function cleanText(value: unknown, max = 240): string {
  return typeof value === "string"
    ? value.replace(/[<>/]/g, " ").replace(/[^\p{L}\p{N} .,'&()+\-_]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function finite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeGrantedScopes(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\s,]+/) : [];
  return [...new Set(values.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
}

export function tokenExpiryIso(value: unknown, now = Date.now()): string {
  const number = finite(value) ?? 0;
  const milliseconds = number > 100_000_000 ? number * 1000 : now + Math.max(0, number) * 1000;
  return new Date(milliseconds).toISOString();
}

export function creatorSearchTerms(preferences: Record<string, unknown> | null): string[] {
  const inputs = [preferences?.inbox_industries, preferences?.industries].flatMap((value) => Array.isArray(value) ? value : []);
  return [...new Set(inputs.map((value) => cleanText(value, 48).toLocaleLowerCase()).filter((value) => value.length >= 2))].slice(0, 4);
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function signTikTokRequest(input: {
  path: string;
  query: Record<string, string | number>;
  body?: string;
  appSecret: string;
}): Promise<string> {
  const query = Object.entries(input.query).filter(([key]) => key !== "sign" && key !== "access_token")
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}${value}`).join("");
  const payload = `${input.appSecret}${input.path}${query}${input.body ?? ""}${input.appSecret}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(input.appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
}

function safeProductUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:" || !(url.hostname === "shop.tiktok.com" || url.hostname.endsWith(".shop.tiktok.com"))) return null;
    return url.toString();
  } catch { return null; }
}

export function mapTikTokProduct(item: JsonRecord, searchTerm: string, observedAt = new Date().toISOString()): JsonRecord | null {
  const id = cleanText(item?.id, 128);
  const title = cleanText(item?.title, 240);
  const url = safeProductUrl(item?.detail_link);
  const rate = finite(item?.commission?.rate);
  const amount = finite(item?.commission?.amount);
  if (!id || !title || !url || (rate === null && amount === null)) return null;
  const shop = cleanText(item?.shop?.name, 160) || "TikTok Shop seller";
  const region = cleanText(item?.sale_region, 12).toLocaleUpperCase();
  const explicitDescription = cleanText(item?.description, 1200);
  const description = explicitDescription || `${title} from ${shop}. Available through a TikTok Shop open collaboration${region ? ` in ${region}` : ""}.`;
  const currency = cleanText(item?.commission?.currency ?? item?.original_price?.currency, 8).toLocaleUpperCase() || null;
  return {
    source_ref: `tiktok:${id}`,
    source_type: "marketplace",
    affiliate_provider: "tiktok_shop",
    brand_name: shop,
    product_name: title,
    title,
    description,
    product_category: cleanText(item?.category?.name ?? item?.category_name ?? searchTerm, 120) || null,
    price_amount: finite(item?.original_price?.minimum_amount),
    currency,
    commission_rate: rate === null ? null : rate / 100,
    commission_amount: amount,
    collaboration_model: "open",
    approval_required: false,
    shipping_regions: region ? [region] : [],
    product_metrics: { units_sold: finite(item?.units_sold), observed_at: observedAt },
    product_url: url,
    provider_verified: true,
    allowed_platforms: ["tiktok"],
    required_platform: "tiktok",
    evidence: { provider: "tiktok_shop", provider_verified: true, product_id: id, search_term: searchTerm, observed_at: observedAt },
  };
}

export async function fetchTikTokProducts(input: {
  appKey: string;
  appSecret: string;
  accessToken: string;
  preferences: Record<string, unknown> | null;
}, fetcher: typeof fetch = fetch): Promise<{ products: JsonRecord[]; nextPageToken: null }> {
  const products = new Map<string, JsonRecord>();
  for (const term of creatorSearchTerms(input.preferences)) {
    const body = JSON.stringify({ title_keywords: [term] });
    const query = {
      app_key: input.appKey, page_size: "20", sort_field: "commission_rate", sort_order: "DESC",
      timestamp: String(Math.floor(Date.now() / 1000)),
    };
    const sign = await signTikTokRequest({ path: SEARCH_PATH, query, body, appSecret: input.appSecret });
    const url = new URL(`${API_ORIGIN}${SEARCH_PATH}`);
    Object.entries({ ...query, sign }).forEach(([key, value]) => url.searchParams.set(key, value));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetcher(url, {
        method: "POST", body, signal: controller.signal,
        headers: { "content-type": "application/json", "x-tts-access-token": input.accessToken },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || Number(payload?.code ?? 0) !== 0) throw new Error(`tiktok_api_${cleanText(payload?.code ?? response.status, 32) || "error"}`);
      for (const item of Array.isArray(payload?.data?.products) ? payload.data.products : []) {
        const mapped = mapTikTokProduct(item, term);
        if (mapped) products.set(mapped.source_ref, mapped);
      }
    } finally { clearTimeout(timeout); }
  }
  return { products: [...products.values()], nextPageToken: null };
}
