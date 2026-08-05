# CaughtUp Opportunities v1 — 2026-08-04

## Outcome

All five controlled Opportunities phases are implemented locally and deployed:

1. opt-in creator direction;
2. creator-confirmed Gmail relationship memory;
3. creator-added brand/domain/HTTPS evidence with deduplicated matching;
4. routine Gmail-sweep signal collection and score/kit refresh;
5. kit-aware Gmail draft creation, authoritative preview, and explicit send.

Opportunity outreach is never connected to inbox Auto-send. No external brand
message was sent during this release.

## Release evidence

- Source commit before production mutation: `a97a57a`.
- Named migration: `20260805011421_opportunities_v1.sql`.
- Linked migration dry run listed only that migration.
- Linked migration list showed local and remote `20260805011421` aligned after push.
- Deployed `agent-api` v15 and `agent-sweep` v33, both ACTIVE.
- Unauthenticated production calls returned HTTP 401 from both functions.
- Extension manifest version: 0.4.0.
- `node --check extension/popup.js`: passed.
- Node/source suites: 79/79 passed twice after final code changes.
- Supabase deployment bundling accepted both Edge Functions and all new shared imports.
- Standalone Deno CLI was unavailable. An `npx deno` fallback did not complete and
  was terminated; this is not counted as passing evidence.

## Safety and ownership checks

- All five new tables have RLS enabled, no client policies, explicit privilege
  revocation from `public`, `anon`, and `authenticated`, and `service_role` access.
- API mutations include `user_id` ownership filters.
- Gmail suggestions are off unless the creator enables Opportunities, ignore
  consumer mail domains, and remain unconfirmed until the creator classifies them.
- Brand URLs must be HTTPS and on the configured brand domain or its subdomain.
- Match reasons and source provenance remain visible in the extension.
- Draft creation requires a direct user action and a configured business contact.
- A live Gmail draft is fingerprinted before explicit send; opportunity sends use
  a separate idempotency table and reconciliation state.
- Outreach draft text passes the existing price, availability, turnaround,
  acceptance, and rejection safety filter.

## Open user-visible acceptance

The production database and functions are deployed, but the final signed-in
popup click-through is open. Reload extension 0.4.0, enable Opportunities, add a
controlled brand with the owner's own Gmail address as contact, prepare the
draft, and inspect the live recipient/body/attachment preview. Do not choose
Send unless the recipient is a controlled address.

## Sourcing recommendation

Use a layered source strategy:

1. Keep the now-live owned Gmail and creator-added URL sources.
2. Add Brave Search API as the first broad discovery adapter, constrained to
   public partnership, ambassador, affiliate, and creator-program pages. Brave
   documents an independent web index, JSON search results, $5 per 1,000 Search
   requests with $5 monthly credits, and separate storage-right requirements:
   https://brave.com/search/api/
3. Add impact.com and Awin as authenticated marketplace adapters for users who
   have accounts. impact.com exposes publisher access to global brand programs;
   Awin documents publisher APIs, bearer-token access, and a 20-request/minute
   user limit:
   https://impact.com/partners/affiliate-partners/
   https://help.awin.com/apidocs/introduction-1
4. Use Apollo only after a brand domain is matched, to locate relevant
   partnership/creator-marketing roles. Apollo's search endpoint does not return
   email or phone by itself; enrichment is a separate step:
   https://docs.apollo.io/reference/people-api-search

The first external adapter is blocked only on choosing a provider account and
placing its API credential in Supabase Vault. No broad scraper is recommended.
