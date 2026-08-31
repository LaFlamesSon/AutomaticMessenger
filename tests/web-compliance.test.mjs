import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../web/", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("California privacy notices expose the required choices in plain language", async () => {
  const [privacy, notice, choices] = await Promise.all([
    read("privacy/index.html"),
    read("notice-at-collection/index.html"),
    read("privacy-choices/index.html"),
  ]);

  for (const phrase of [
    "right to know", "right to delete", "right to correct",
    "right to opt out", "right to limit", "non-discrimination",
    "authorized agent", "Global Privacy Control", "past 12 months",
  ]) assert.match(privacy.toLowerCase(), new RegExp(phrase.toLowerCase()));

  assert.match(notice, /at or before collection/i);
  assert.match(notice, /retention/i);
  assert.match(notice, /sell or share/i);
  assert.match(choices, /do not sell or share/i);
  assert.match(choices, /support@getcaughtup\.io/i);
});

test("public pages link the privacy choices and collection notice", async () => {
  const pages = [
    "index.html", "privacy/index.html", "terms/index.html", "security/index.html",
    "support/index.html", "billing/index.html", "privacy-choices/index.html",
    "notice-at-collection/index.html", "404.html",
  ];
  for (const page of pages) {
    const html = await read(page);
    assert.match(html, /href="\/privacy-choices\/"/i, page);
    assert.match(html, /href="\/notice-at-collection\/"/i, page);
  }
});

test("static assets send transport and browser hardening headers", async () => {
  const headers = await read("_headers");
  assert.match(headers, /Strict-Transport-Security:\s*max-age=31536000/i);
  assert.match(headers, /Content-Security-Policy:/i);
  assert.match(headers, /frame-ancestors 'none'/i);
  assert.match(headers, /X-Content-Type-Options:\s*nosniff/i);
});

test("sitemap includes public compliance pages", async () => {
  const sitemap = await read("sitemap.xml");
  assert.match(sitemap, /https:\/\/getcaughtup\.io\/privacy-choices\//);
  assert.match(sitemap, /https:\/\/getcaughtup\.io\/notice-at-collection\//);
});
