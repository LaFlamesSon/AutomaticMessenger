# Listing-backed affiliate channels and daily feed — 2026-08-07

## Corrected product rule

Creator profile and performance data decide whether an affiliate product is relevant. They do not decide where a product should be posted. The extension shows a channel only when the provider listing or programme supplies that evidence.

Awin's standard product-feed columns contain catalog information rather than a product-level TikTok/Instagram placement field. Publisher promotional type and advertiser programme rules are separate. Therefore, an ordinary Awin feed record without explicit programme evidence must display no platform instruction.

## Pass conditions

1. The same Awin listing exposes the same listing platforms regardless of creator performance.
2. Awin products without explicit listing/programme channel evidence show no platform instruction.
3. Native TikTok Shop products and explicit listing requirements remain authoritative.
4. High commission alone cannot make an unrelated product visible.
5. At most ten new relevant, commission-bearing products are surfaced per creator per local calendar day.
6. Daily allocation is atomic under concurrent requests and remains owner-scoped.
7. Cards stay limited to product, company, commission, optional listing-backed platform, and product link.

## Closed-loop evidence

The initial focused tests failed because the previous implementation derived a posting recommendation from the creator's strongest platform and had no daily batching primitive. That model was removed before deployment.

Current focused verification:

- `npx.cmd --yes deno test supabase/tests/affiliate.test.ts`: 9 passed, 0 failed.
- `npx.cmd --yes deno check supabase/functions/agent-api/index.ts`: passed.
- `node --test extension/tests/markup.test.js supabase/tests/platform-routing-source-contract.test.mjs`: 29 passed, 0 failed.

Full regression verification:

- `npx.cmd --yes deno test supabase/tests/*.ts`: 98 passed, 0 failed, including the existing 50-case affiliate benchmark.
- `node --check extension/popup.js` plus all extension/API source contracts: 87 passed, 0 failed.
- `npx.cmd --yes supabase@latest db push --dry-run`: passed and identified only this pending migration.

## Current boundary

Migration `20260808045255_creator_platform_routing.sql` and `agent-api` v19 were deployed. A harmless call using a nonexistent user then exposed that the allocator referenced a timestamp column absent from `ia_opportunities`; no user rows changed. Named follow-up migration `20260808052904_fix_affiliate_daily_surface_order.sql` switched the order to `created_at`.

Live closeout evidence:

- The follow-up migration is applied and the remote database reports no pending migrations.
- `agent-api` version 19 is `ACTIVE`.
- All seven new columns exist with their expected database types.
- The allocator is `SECURITY INVOKER`; its ACL grants execution to `postgres` and `service_role`, not `anon` or `authenticated`.
- Calling it with a nonexistent user succeeds and returns zero rows.
- The live invariant query reports zero creator/day groups above ten surfaced opportunities.
- Supabase security advisors reported no issue on the new function. Existing unrelated warnings remain for `pg_net`, `rls_auto_enable()`, and disabled leaked-password protection.

Extension source is version 0.4.7 and must be reloaded as an unpacked extension to display the new cards.
