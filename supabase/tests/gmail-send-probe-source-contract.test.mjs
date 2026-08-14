import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("probe requests only identity and gmail.send through separate configuration", async () => {
  const api = await read("functions/agent-api/index.ts");
  assert.match(api, /case "gmail_send_probe_start"/);
  assert.match(api, /ia_google_send_probe_client_id/);
  assert.match(api, /ia_google_send_probe_client_secret/);
  assert.match(api, /ia_google_send_probe_enabled/);
  assert.match(
    api,
    /openid email profile https:\/\/www\.googleapis\.com\/auth\/gmail\.send/,
  );
  assert.match(api, /consent\.searchParams\.set\("login_hint", probeEmail\)/);
  const block =
    api.match(/case "gmail_send_probe_start":[\s\S]*?case "calendar_get":/)
      ?.[0] ?? "";
  assert.doesNotMatch(
    block,
    /gmail\.modify|gmail\.readonly|gmail\.compose|gmail\.settings/,
  );
});

test("probe is state-bound, allowlisted, self-addressed, and never persists tokens", async () => {
  const probe = await read("functions/gmail-send-probe/index.ts");
  assert.match(probe, /state_hash/);
  assert.match(probe, /allowedChromeRedirect/);
  assert.match(probe, /ia_google_send_probe_email/);
  assert.match(probe, /authorizedEmail !== expectedEmail/);
  assert.match(probe, /To: \$\{email\}/);
  assert.match(probe, /From: CaughtUp OAuth Test <\$\{email\}>/);
  assert.match(probe, /X-CaughtUp-Test: \$\{TEST_MARKER\}/);
  assert.match(probe, /users\/me\/messages\/send/);
  assert.match(probe, /https:\/\/oauth2\.googleapis\.com\/revoke/);
  assert.match(probe, /AbortSignal\.timeout\(15_000\)/);
  assert.match(probe, /!tokens\.access_token \|\| !tokens\.refresh_token/);
  assert.doesNotMatch(
    probe,
    /ia_gmail_accounts|refresh_token:\s*tokens\.refresh_token|\.insert\(\{[^}]*access_token/s,
  );
  assert.doesNotMatch(probe, /await\s+\w+\.text\(\)/);
});

test("probe callback returns only bounded status codes to the extension", async () => {
  const probe = await read("functions/gmail-send-probe/index.ts");
  assert.match(probe, /caughtup_gmail_probe/);
  assert.match(probe, /code_exchange_failed/);
  assert.match(probe, /minimal_scope_missing/);
  assert.match(probe, /wrong_test_account/);
  assert.match(probe, /gmail_send_failed/);
  assert.doesNotMatch(
    probe,
    /tokenResponse\.json\(\)[\s\S]*completionRedirect\([^)]*tokens/,
  );
});

test("browser probe start is short-lived, signed, and retains the same minimal scope", async () => {
  const probe = await read("functions/gmail-send-probe/index.ts");
  assert.match(probe, /url\.searchParams\.get\("start"\) === "1"/);
  assert.match(probe, /signedBrowserState/);
  assert.match(probe, /validBrowserState/);
  assert.match(probe, /crypto\.subtle\.verify/);
  assert.match(probe, /Date\.now\(\) \+ 10 \* 60_000/);
  assert.match(probe, /scope", `openid email profile \$\{REQUIRED_SCOPE\}`/);
  assert.match(probe, /login_hint", expectedEmail/);
  const consentBlock =
    probe.match(/function googleConsent[\s\S]*?return consent;/)?.[0] ?? "";
  assert.doesNotMatch(
    consentBlock,
    /gmail\.modify|gmail\.readonly|gmail\.compose|gmail\.settings/,
  );
});
