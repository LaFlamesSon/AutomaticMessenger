"use strict";

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const api = readFileSync(new URL("../functions/agent-api/index.ts", import.meta.url), "utf8");

test("temporary external stress sender is exact, bounded, Review-only, and non-retrying", () => {
  assert.match(api, /TEMP_EXTERNAL_STRESS_RUN = "CUFWD20-20260814A"/);
  assert.match(api, /TEMP_EXTERNAL_STRESS_SENDER = "carolynpaezz\.mgmt@gmail\.com"/);
  assert.match(api, /TEMP_EXTERNAL_STRESS_TARGET = "yafet2132@gmail\.com"/);
  assert.match(api, /case "temporary_external_stress_send"/);
  const action = api.match(/case "temporary_external_stress_send": \{([\s\S]*?)\n      case "forwarding_setup_disable"/)?.[1] ?? "";
  assert.match(action, /body\.confirm !== true/);
  assert.match(action, /body\.count !== 20/);
  assert.match(action, /profile\?\.reply_mode !== "draft_only" \|\| profile\?\.auto_send !== false/);
  assert.match(action, /eq\("status", "active"\)/);
  assert.match(action, /eq\("oauth_capability", "legacy_disabled"\)/);
  assert.match(action, /TEMP_EXTERNAL_STRESS_CASES\.length/);
  assert.match(action, /X-CaughtUp-Test|buildTestInboxMime/);
  assert.doesNotMatch(action, /auto_send_confirm|forwarded_send|setTimeout|while \(/);
});
