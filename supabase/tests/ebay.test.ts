import { assert, assertEquals } from "jsr:@std/assert";
import {
  ebaySearchTerms, fetchEbayProducts, mapEbayItem, normalizeEbayCampaignId,
} from "../functions/_shared/ebay.ts";

Deno.test("eBay campaign ids are exactly ten digits", () => {
  assertEquals(normalizeEbayCampaignId(" 1234567890 "), "1234567890");
  assertEquals(normalizeEbayCampaignId("12345"), null);
  assertEquals(normalizeEbayCampaignId("12345abcde"), null);
});

Deno.test("eBay searches use bounded creator profile terms", () => {
  assertEquals(ebaySearchTerms({
    industries: ["fitness", "beauty"], creator_styles: ["lifestyle"], content_formats: ["review"],
  }), ["fitness", "beauty", "lifestyle"]);
  assertEquals(ebaySearchTerms({ industries: ["<script>fitness</script>"] }), ["script fitness script"]);
  assertEquals(ebaySearchTerms({}), ["creator products"]);
});

Deno.test("eBay mapping requires a verified eBay affiliate URL and never invents economics", () => {
  const item = {
    itemId: "v1|123|0", title: "Fitness resistance bands", brand: "PulseFit",
    itemAffiliateWebUrl: "https://www.ebay.com/itm/123?campid=1234567890#details",
    price: { value: "24.99", currency: "USD" }, categories: [{ categoryName: "Fitness" }],
    seller: { feedbackPercentage: "99.8" }, condition: "New",
  };
  const product = mapEbayItem(item, "2026-08-08T00:00:00.000Z");
  assert(product);
  assertEquals(product.product_url, "https://www.ebay.com/itm/123?campid=1234567890");
  assertEquals(product.price_amount, 24.99);
  assertEquals(product.evidence.provider_verified, true);
  assertEquals(mapEbayItem({ ...item, itemAffiliateWebUrl: "https://evil.example/item" }, "now"), null);
  assertEquals(mapEbayItem({ ...item, itemAffiliateWebUrl: undefined }, "now"), null);
});

Deno.test("eBay fetch uses app OAuth and campaign attribution", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("/oauth2/token")) return Response.json({ access_token: "token-value-that-is-long-enough" });
    return Response.json({ itemSummaries: [{
      itemId: "item-1", title: "Yoga mat", brand: "MoveWell",
      itemAffiliateWebUrl: "https://www.ebay.com/itm/item-1?campid=1234567890",
      price: { value: "30", currency: "USD" }, categories: [{ categoryName: "Yoga" }],
    }] });
  };
  const products = await fetchEbayProducts({
    clientId: "client", clientSecret: "secret", campaignId: "1234567890",
    preferences: { industries: ["yoga"] }, affiliateReferenceId: "caughtup-test",
  }, fetcher);
  assertEquals(products.length, 1);
  assertEquals(calls.length, 2);
  assert(String(calls[0].init?.headers && (calls[0].init?.headers as Record<string, string>).Authorization).startsWith("Basic "));
  const searchHeaders = calls[1].init?.headers as Record<string, string>;
  assertEquals(searchHeaders["X-EBAY-C-MARKETPLACE-ID"], "EBAY_US");
  assert(searchHeaders["X-EBAY-C-ENDUSERCTX"].includes("affiliateCampaignId=1234567890"));
  assert(calls[1].url.includes("q=yoga"));
});
