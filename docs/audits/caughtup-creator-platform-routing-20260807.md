# Creator-specific affiliate platform routing — 2026-08-07

## Goal

For every commission-verified affiliate product, distinguish evidence-backed channel requirements from CaughtUp's creator-specific recommendation. Show the creator where to promote the product without adding provider-account friction or cluttering the product feed.

## Pass conditions

1. A provider- or brand-required platform is authoritative and labeled `Required on`.
2. An Awin-style cross-platform product routes to the creator's strongest related platform metric and is labeled `Recommended for`.
3. A creator who does not use a required platform does not see that product in the feed.
4. High commission by itself cannot make a product from an unrelated category visible.
5. Unknown or unsupported platform values fail validation rather than becoming matching evidence.
6. Provider evidence, creator recommendation basis, eligibility, and reasons are stored separately on owner-scoped opportunity rows.
7. Product cards remain limited to product, company, commission, platform direction, and the product link.

## Closed-loop evidence

The first focused test run failed because the affiliate match result did not expose a recommended platform or distinguish required/provider-native evidence from creator performance. The implementation added deterministic routing and a named migration, then wired the result through `agent-api` and the extension.

Source verification after the fix:

- `npx.cmd --yes deno test supabase/tests/*.ts`: 96 passed, 0 failed, including the existing 50-case affiliate benchmark and seven focused affiliate tests.
- `npx.cmd --yes deno check supabase/functions/agent-api/index.ts`: passed.
- `node --check extension/popup.js`: passed.
- `node --test extension/tests/*.test.js supabase/tests/*-contract.test.mjs`: 86 passed, 0 failed.

## Current boundary

The implementation is complete and verified in source. Migration `20260808045255_creator_platform_routing.sql` and the updated `agent-api` remain undeployed pending explicit live-change authorization. Extension source is version 0.4.6 and will need an unpacked-extension reload after deployment.
