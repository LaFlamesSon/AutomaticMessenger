export interface EbayProduct {
  provider_opportunity_id: string;
  brand_name: string;
  brand_domain: "ebay.com";
  product_name: string;
  product_category: string;
  description: string;
  tags: string[];
  product_url: string;
  price_amount: number | null;
  currency: string | null;
  shipping_regions: string[];
  product_metrics: Record<string, unknown>;
  evidence: Record<string, unknown>;
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function bounded(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function finiteMoney(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : null;
}

function safeAffiliateUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 1000) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLocaleLowerCase();
    if (url.protocol !== "https:" || url.username || url.password ||
      !(host === "ebay.com" || host.endsWith(".ebay.com"))) return null;
    url.hash = "";
    return url.toString();
  } catch { return null; }
}

export function normalizeEbayCampaignId(value: unknown): string | null {
  const campaignId = typeof value === "string" ? value.trim() : "";
  return /^[0-9]{10}$/.test(campaignId) ? campaignId : null;
}

export function ebaySearchTerms(preferences: Record<string, unknown> | null): string[] {
  const lists = [preferences?.industries, preferences?.creator_styles, preferences?.content_formats];
  const terms: string[] = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const term = bounded(item, 80).normalize("NFKC").replace(/[^\p{L}\p{N} &+'-]+/gu, " ")
        .replace(/\s+/g, " ").trim();
      if (term.length >= 2 && !terms.some((current) => current.toLocaleLowerCase() === term.toLocaleLowerCase())) terms.push(term);
      if (terms.length === 3) return terms;
    }
  }
  return terms.length ? terms : ["creator products"];
}

export function mapEbayItem(item: any, fetchedAt: string): EbayProduct | null {
  const id = bounded(item?.itemId, 300);
  const title = bounded(item?.title, 300);
  const productUrl = safeAffiliateUrl(item?.itemAffiliateWebUrl);
  if (!id || !title || !productUrl) return null;
  const category = bounded(item?.categories?.[0]?.categoryName, 160);
  const brand = bounded(item?.brand, 120) || bounded(item?.seller?.username, 120) || "eBay seller";
  const currency = bounded(item?.price?.currency, 3).toUpperCase();
  const condition = bounded(item?.condition, 80);
  const feedbackPercentage = finiteMoney(item?.seller?.feedbackPercentage);
  return {
    provider_opportunity_id: id,
    brand_name: brand,
    brand_domain: "ebay.com",
    product_name: title,
    product_category: category,
    description: bounded([category, condition].filter(Boolean).join(" · "), 2000),
    tags: Array.from(new Set([category, brand].filter(Boolean))).slice(0, 30),
    product_url: productUrl,
    price_amount: finiteMoney(item?.price?.value),
    currency: /^[A-Z]{3}$/.test(currency) ? currency : null,
    shipping_regions: ["US"],
    product_metrics: {
      ...(condition ? { condition } : {}),
      ...(feedbackPercentage !== null ? { seller_feedback_percent: feedbackPercentage } : {}),
    },
    evidence: { provider: "ebay", provider_verified: true, fetched_at: fetchedAt },
  };
}

async function applicationToken(clientId: string, clientSecret: string, fetcher: Fetcher): Promise<string> {
  const response = await fetcher("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`ebay_token_${response.status}`);
  const body = await response.json();
  const token = bounded(body?.access_token, 8192);
  if (!token) throw new Error("ebay_token_invalid");
  return token;
}

export async function fetchEbayProducts(options: {
  clientId: string;
  clientSecret: string;
  campaignId: string;
  preferences: Record<string, unknown> | null;
  affiliateReferenceId: string;
}, fetcher: Fetcher = fetch): Promise<EbayProduct[]> {
  const campaignId = normalizeEbayCampaignId(options.campaignId);
  if (!campaignId) throw new Error("ebay_campaign_invalid");
  if (!options.clientId || !options.clientSecret) throw new Error("ebay_not_configured");
  const token = await applicationToken(options.clientId, options.clientSecret, fetcher);
  const products: EbayProduct[] = [];
  const seen = new Set<string>();
  const fetchedAt = new Date().toISOString();
  for (const term of ebaySearchTerms(options.preferences)) {
    const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
    url.searchParams.set("q", term);
    url.searchParams.set("limit", "10");
    url.searchParams.set("filter", "buyingOptions:{FIXED_PRICE},deliveryCountry:US");
    const response = await fetcher(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        "X-EBAY-C-ENDUSERCTX": `affiliateCampaignId=${campaignId},affiliateReferenceId=${bounded(options.affiliateReferenceId, 256)}`,
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`ebay_search_${response.status}`);
    const body = await response.json();
    for (const item of Array.isArray(body?.itemSummaries) ? body.itemSummaries : []) {
      const product = mapEbayItem(item, fetchedAt);
      if (product && !seen.has(product.provider_opportunity_id)) {
        seen.add(product.provider_opportunity_id);
        products.push(product);
      }
    }
  }
  return products.slice(0, 30);
}
