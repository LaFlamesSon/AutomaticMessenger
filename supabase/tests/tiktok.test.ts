import { assert, assertEquals } from "jsr:@std/assert";
import {
  creatorSearchTerms, fetchTikTokProducts, mapTikTokProduct, normalizeGrantedScopes,
  signTikTokRequest, TIKTOK_CREATOR_SCOPE, tokenExpiryIso,
} from "../functions/_shared/tiktok.ts";

Deno.test("TikTok signing matches the official HMAC-SHA256 vector", async () => {
  const sign = await signTikTokRequest({
    path: "/authorization/202309/shops",
    query: { app_key: "29a39d", timestamp: "1623812664" },
    body: "",
    appSecret: "e59af819cc",
  });
  assertEquals(sign, "b596b73e0cc6de07ac26f036364178ab16b0a907af13d43f0a0cd2345f582dc8");
});

Deno.test("TikTok creator scopes and expiries normalize fail-closed", () => {
  assertEquals(normalizeGrantedScopes(`${TIKTOK_CREATOR_SCOPE}, creator.profile.read`), [
    TIKTOK_CREATOR_SCOPE, "creator.profile.read",
  ]);
  assertEquals(normalizeGrantedScopes([TIKTOK_CREATOR_SCOPE, TIKTOK_CREATOR_SCOPE, 3]), [TIKTOK_CREATOR_SCOPE]);
  assertEquals(tokenExpiryIso(3600, 1_700_000_000_000), "2023-11-14T23:13:20.000Z");
  assertEquals(tokenExpiryIso(1_800_000_000, 1_700_000_000_000), "2027-01-15T08:00:00.000Z");
});

Deno.test("TikTok searches use separate bounded creator-affinity terms", () => {
  assertEquals(creatorSearchTerms({ inbox_industries: ["fitness", "beauty"], industries: ["travel"] }), [
    "fitness", "beauty", "travel",
  ]);
  assertEquals(creatorSearchTerms({ inbox_industries: ["<script>fitness</script>", "fitness"] }), [
    "script fitness script", "fitness",
  ]);
  assert(creatorSearchTerms({ industries: ["a", "b", "c", "d", "e", "fashion"] }).length <= 4);
});

Deno.test("TikTok product mapping preserves listing-backed economics and platform", () => {
  const product = mapTikTokProduct({
    id: "1729432087292775344",
    title: "Resistance band set",
    description: "Five resistance levels for home workouts.",
    shop: { name: "MoveWell" },
    sale_region: "US",
    detail_link: "https://shop.tiktok.com/view/product/1729432087292775344?region=US",
    original_price: { currency: "USD", minimum_amount: "24.99" },
    commission: { rate: 1500, amount: "3.75", currency: "USD" },
    units_sold: 1200,
  }, "fitness", "2026-08-08T00:00:00.000Z");
  assert(product);
  assertEquals(product.commission_rate, 15);
  assertEquals(product.commission_amount, 3.75);
  assertEquals(product.required_platform, "tiktok");
  assertEquals(product.allowed_platforms, ["tiktok"]);
  assertEquals(product.description, "Five resistance levels for home workouts.");
  assertEquals(product.shipping_regions, ["US"]);
});

Deno.test("TikTok catalog requests are signed, creator-authenticated, and deduplicated", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init });
    const term = JSON.parse(String(init?.body || "{}"))?.title_keywords?.[0] || "";
    return Response.json({ code: 0, data: { products: [{
      id: term === "fitness" ? "product-1" : "product-2",
      title: `${term} creator product`, shop: { name: "Creator Shop" }, sale_region: "US",
      detail_link: `https://shop.tiktok.com/view/product/${term === "fitness" ? "product-1" : "product-2"}`,
      original_price: { currency: "USD", minimum_amount: "20" },
      commission: { rate: 1000, amount: "2", currency: "USD" },
    }] } });
  };
  const result = await fetchTikTokProducts({
    appKey: "app-key", appSecret: "app-secret", accessToken: "creator-access-token",
    preferences: { inbox_industries: ["fitness", "beauty"] },
  }, fetcher);
  assertEquals(result.products.length, 2);
  assertEquals(calls.length, 2);
  for (const call of calls) {
    const url = new URL(call.url);
    assertEquals(url.pathname, "/affiliate_creator/202405/open_collaborations/products/search");
    assertEquals(url.searchParams.get("page_size"), "20");
    assertEquals(url.searchParams.get("sort_field"), "commission_rate");
    assertEquals(url.searchParams.get("sort_order"), "DESC");
    assert(/^[a-f0-9]{64}$/.test(url.searchParams.get("sign") || ""));
    assertEquals((call.init?.headers as Record<string, string>)["x-tts-access-token"], "creator-access-token");
    assertEquals(JSON.parse(String(call.init?.body)).title_keywords.length, 1);
  }
});
