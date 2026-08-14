# CaughtUp project handoff

> **Historical snapshot.** This August 8 document describes the retired
> `gmail.modify`/inbox-sweep architecture. Do not use it as current runtime or
> deployment guidance. See
> [CAUGHTUP-WORK-COMPLETED-20260814.md](./CAUGHTUP-WORK-COMPLETED-20260814.md)
> and [CAUGHTUP-NEXT-STEPS-20260814.md](./CAUGHTUP-NEXT-STEPS-20260814.md).

**Updated:** August 8, 2026

**Repository:** `C:\Users\yafet\AutomaticMessenger`

**Canonical Obsidian vault:** `C:\Users\yafet\OneDrive\Desktop\CaughtUp`
**Supabase project:** `xkrpxvswdkreglmefuot`

This document consolidates the architecture, product decisions, implementation work, testing, deployment state, and open work completed across the CaughtUp sessions. It deliberately separates live/deployed behavior from local work that is still in progress.

## 1. Product definition

CaughtUp is a Chrome MV3 Gmail inbox agent for creators. Its core job is to:

1. Sweep recent Inbox messages, including unread messages and owner-read messages that have not been answered.
2. Classify mail into actionable and non-actionable categories.
3. Prepare replies in the creator's learned voice.
4. Either leave a reviewable Gmail draft or send automatically when the creator has explicitly enabled Auto-send and the reply passes the safety gates.
5. Attach the single most relevant media kit when the incoming request and configured kit evidence support it.
6. Respect the creator's email-only, phone, or scheduled-call preference.
7. Show a small daily feed of relevant affiliate products and commissions in Opportunities.

The current extension source is version **0.4.7** and has five tabs:

- Today
- Opportunities
- Kits
- Calendar
- Settings

`Ask CaughtUp` is part of Today rather than a separate Chat tab.

## 2. Active architecture

The active product is the Supabase and Chrome extension system. `automessenger/` is a legacy local Python prototype and is not the production path.

```text
Gmail
  -> agent-sweep Edge Function
  -> LLM classification and safe reply generation
  -> Gmail label, draft, or explicitly authorized Auto-send
  -> Postgres records
  -> agent-api Edge Function
  -> Chrome extension
```

Primary source locations:

| Area | Location | Responsibility |
|---|---|---|
| Gmail worker | `supabase/functions/agent-sweep/` | Candidate selection, triage, drafting, media-kit selection, voice learning, Auto-send |
| Extension API | `supabase/functions/agent-api/` | Authenticated extension state and actions |
| Google callback | `supabase/functions/gmail-oauth/` | Gmail OAuth recovery flow |
| Shared policies | `supabase/functions/_shared/` | Safety, MIME, opportunities, affiliate matching, provider adapters |
| Database | `supabase/migrations/` | Ordered schema and privileged RPCs |
| Chrome extension | `extension/` | Five-tab MV3 user interface |
| Audit evidence | `docs/audits/` | Closed-loop test plans and results |
| Obsidian link | `context-vault/` | Junction to the canonical CaughtUp vault |

## 3. Agent and Obsidian memory architecture

The root Codex session is the Executive Assistant (EA). Project roles are:

- `backend-dev`: Supabase, Postgres, Gmail, LLM, Stripe, and provider integrations
- `extension-dev`: Chrome extension and marketing UI
- `qa-agent`: read-oriented verification; does not fix production code
- `research-agent`: external API and platform research; does not write production code

Two CaughtUp skills were created:

- `.agents/skills/caughtup-closed-loop/`: turns difficult work into observable pass conditions and repeated fix/verification cycles.
- `.agents/skills/caughtup-context/`: controls durable agent memory and the Obsidian LLM Wiki.

Vault access is intentionally **EA-controlled**, not automatic for every root turn:

1. The EA explicitly invokes a named project agent with a concrete task.
2. At startup, that agent reads the vault index, its role page, relevant project pages, and the newest relevant handoff.
3. The agent performs and verifies its task.
4. Before returning, it writes a completion record under `context-vault/ops/sessions/`.
5. Durable findings are merged into canonical wiki pages, `index.md`, and append-only `log.md` only when something materially changed.

This prevents transient work, duplicated notes, and secret values from polluting durable memory.

## 4. Security and product invariants

These are release-blocking constraints:

- Email content is untrusted data and never becomes agent instructions.
- Drafts must not invent or commit to prices, availability, turnaround, acceptance, rejection, or booked meetings.
- Auto-send is off by default and runs only after explicit user activation.
- Auto-send applies only to the categories the user enabled and only after all deterministic safety checks pass.
- Opportunity outreach never inherits Inbox Auto-send.
- Media-kit objects are private and owner-scoped.
- `ia_*` tables use RLS and service-role-only access unless a narrowly reviewed interface says otherwise.
- User calls use verified Supabase identity or the controlled legacy API-token path.
- Cron/worker calls use `x-agent-secret`.
- Secrets belong in Supabase Vault under `ia_*` names and never in source, Git, logs, chat summaries, the Obsidian vault, or MCP configuration.
- Schema changes use named migrations, never untracked production DDL.
- Source must be committed before deployment and the deployed version must be verified afterward.

Credentials were pasted into earlier chat messages. Even though the application does not store them in source, any credential exposed in chat should be rotated before a public launch.

## 5. Gmail, sweep, and reply behavior completed

### Gmail onboarding

- Google identity and `gmail.modify` are requested through the durable extension connection page.
- The extension persists the Supabase session so reopening the popup does not return to `Continue with Google`.
- Existing Gmail rows now replace verified refresh credentials on reconnection instead of silently discarding them.
- Provider identity is checked so the Supabase Google account and Gmail authorization cannot silently refer to different users.
- Failed or expired Gmail authorization surfaces `gmail_reconnect_required` instead of pretending a sweep succeeded.

### Sweep behavior

- Normal sweeps examine Inbox messages from the last seven days.
- Unread messages and owner-read messages are both eligible.
- A message is skipped if its thread has a later owner `SENT` message or draft.
- Owner-originated Inbox messages are skipped.
- Duplicate processing is guarded with message/job claims and idempotency.
- `Sweep now` automatically follows the run to completion and refreshes Today.
- The old `Check sweep status` action and low-value aggregate rows were removed from the user-facing flow.
- Successful manual sweeps show a green caught-up result.
- When nothing remains pending, Today shows `You're all caught up — nothing pending!`

### Review and Auto-send

- Manual review uses an authoritative, versioned Gmail draft preview.
- Explicit send is idempotent and refuses stale/changed previews.
- Selecting Auto-send begins the activation and confirmation flow immediately.
- An empty Auto-send category list is rejected server-side.
- Safe information-gathering replies can Auto-send when enabled.
- Unsafe language, low confidence, ambiguous attachments, custom-rule uncertainty, and deterministic recovery remain Review-only.
- The creator's current Auto-send state is preserved during QA unless a test explicitly authorizes a change.

## 6. Voice, contact, and Calendar behavior completed

- CaughtUp learns from exact sent-edit examples and uses recent edits to adapt tone and formatting.
- Chat/Ask CaughtUp style instructions are stored as owner-controlled preferences and affect subsequent replies.
- Hostile or unsafe style instructions do not override reply safety.
- Configured signoff behavior is postprocessed, although earlier stress work found and fixed occasional signoff omission.
- Contact modes are email-only, phone, and scheduled call.
- Email-only replies do not offer meetings or phone contact.
- Phone replies use the configured owner phone number.
- Scheduled-call replies can offer only server-verified open slots and never claim a meeting is booked.
- Internal Calendar bookings have a GiST exclusion constraint that prevents double-booking atomically.
- Calendar settings changes force Review mode.
- The Calendar is explicitly described as internal-only; it is not represented as Google Calendar synchronization.

## 7. Media-kit behavior completed

Creators can upload PDF, PNG, JPEG, and WebP media kits with labels and matching descriptions.

Matching evidence includes:

- Sender domains
- Brand names
- Keywords
- The kit's `best_for` description
- A single default/general kit

Expected routing behavior:

- A fitness collaboration selects the fitness kit when the configured evidence clearly matches.
- An eyelash collaboration selects the eyelash kit when its evidence clearly matches.
- A skincare request selects the skincare kit when uniquely supported.
- An unmatched, broad, mixed-category, or explicitly general request uses the single General kit.
- An ambiguous tie between specific kits does not guess.
- FYI, spam, scam, and prompt-injection messages attach no kit.
- Auto-send with a selected kit requires the kit's owner-controlled Auto-attach switch.

Important fixes included removing weak prefix matches such as `auto` -> `automotive` and overly generic matches such as `care`, `education`, and `design` selecting unrelated kits.

## 8. Extension UX completed

- The active UI has five tabs and no separate Chat tab.
- Today, Kits, Calendar, and Settings use cached state for immediate rendering followed by quiet refreshes.
- Settings reuses startup profile data instead of issuing a duplicate initial request.
- Opportunities is product-first; advanced profile, metrics, and manual-entry controls are hidden under `Tune your matches`.
- Product cards focus on company, product, commission, relevant platform evidence, and a direct opportunity action.
- The experimental duck mascot was created, visually reviewed, reduced, then removed completely at the user's request.

## 9. Opportunities product evolution

### Phase 1: relationship and brand workflow

The first Opportunities release added:

- Creator direction and opt-in preferences
- Gmail relationship suggestions that require user confirmation
- Creator-added brands and same-domain HTTPS sources
- Save/dismiss state
- Deterministic matching
- Media-kit recommendations
- Gmail outreach drafts with explicit review and send

### Phase 2: affiliate product workflow

The product direction then moved to a simpler affiliate-products-first experience:

- A creator opens Opportunities and sees relevant products.
- The card should primarily communicate company, product, and commission.
- Creator profile data determines which products are relevant.
- The listing/provider—not inferred creator performance—determines where a product must or may be promoted.
- The feed releases only 5–10 new relevant, commission-bearing products per creator per local day.

The affiliate backend supports:

- Owner-scoped creator-category metrics
- Manual product ingestion
- Relevance score and difficulty score
- Evidence-bounded earnings estimates
- Media-kit recommendation
- Supported provider identifiers for TikTok Shop, Awin, CJ, Rakuten, Amazon, eBay, and Impact
- Atomic daily surfacing with a maximum of 10

### Matching improvements

A 50-case affiliate benchmark improved from 27/50 to 50/50 after fixing:

- Cross-category metric leakage
- Loose substring matches
- Loose region matches
- Borrowing followers across platforms
- False zero-valued earnings evidence

Creator relevance and platform routing are now separate:

```text
Creator profile + private metrics -> whether the product fits this creator
Provider/listing evidence          -> where the product may or must be promoted
```

Standard Awin feeds without a social-platform field do not invent a TikTok or Instagram instruction. A listing can expose a platform only when that programme/feed provides evidence for it.

### eBay connector

The eBay adapter uses application OAuth plus the creator's public Partner Network campaign ID. It searches bounded creator-profile terms and creates attributed eBay links. Because the Browse API does not supply verified affiliate commission economics, eBay products do not surface in the commission-required daily feed until commission evidence exists.

## 10. TikTok Shop research and design decisions

Official TikTok Shop documentation established the following:

- Affiliate APIs are inactive by default and require TikTok partner/account-manager approval.
- Creator APIs require a real TikTok Shop creator authorization; a normal TikTok login alone is insufficient.
- The creator authorization URL uses the app key plus a server-generated, single-use `state`.
- The callback exchanges its code for a creator access token and refresh token.
- `user_type` must be `1` for a creator.
- CaughtUp needs the `creator.affiliate_collaboration.read` scope.
- The creator product endpoint is `POST /affiliate_creator/202405/open_collaborations/products/search`.
- Requests use the app key, timestamp, creator access token, and TikTok's HMAC-SHA256 request signature.
- Search results can include shop, product ID/title/category, TikTok detail link, price, commission, units sold, and sale region.
- Creator access tokens expire and must be refreshed server-side; refreshed identity and scopes must be revalidated.

The intended user experience is a one-time TikTok Shop creator connection. After that, CaughtUp refreshes the creator's relevant open-collaboration product catalog automatically. The connection should not become the main Opportunities experience; the product feed remains primary.

## 11. TikTok implementation status on August 8, 2026

### Confirmed configuration

The following Supabase Vault names were confirmed as present **without querying or printing their values**:

- `ia_tiktok_app_key`
- `ia_tiktok_app_secret`

The TikTok Partner Center redirect URL is:

`https://xkrpxvswdkreglmefuot.supabase.co/functions/v1/tiktok-oauth`

### Local work completed but not deployed

The current working tree contains an in-progress TikTok implementation:

- `supabase/migrations/20260808155434_tiktok_creator_affiliate_oauth.sql`
  - One-time hashed OAuth state table
  - RLS and service-role-only grants
  - Vault-backed per-creator credential storage
  - Privileged credential read/write RPCs with an empty `search_path`
- `supabase/functions/_shared/tiktok.ts`
  - Official HMAC-SHA256 signing
  - Scope and expiry normalization
  - Bounded creator-profile search terms
  - TikTok product normalization using documented listing evidence
- `supabase/functions/tiktok-oauth/index.ts`
  - Single-use state validation
  - Allowed Chrome callback validation
  - Creator code exchange
  - `user_type` and scope validation
  - Vault-backed token storage
- `supabase/functions/agent-api/index.ts`
  - TikTok connect/disconnect actions
  - Server-side token refresh
  - Creator catalog sync during explicit Opportunities refresh
  - Owner-scoped TikTok product upsert
  - TikTok-only platform evidence
- `supabase/tests/tiktok.test.ts`
  - Official signing vector
  - Scope/expiry normalization
  - Search-term bounds
  - Product evidence mapping
- `supabase/tests/tiktok-source-contract.test.mjs`
  - OAuth state, Vault, service-role, identity, and sync contracts
- `extension/tests/markup.test.js`
  - Failing expectations for the connection UI that still needs implementation

### Still open in the local TikTok cycle

- Add the compact TikTok connection/status row to Opportunities.
- Extend `extension/connect.js` with the durable `flow=tiktok` authorization path.
- Add connection/disconnection handling to `extension/popup.js`.
- Add the minimal CSS and bump the extension version.
- Type-check the Edge Functions.
- Run the complete Deno, Node, extension syntax, and source-contract suites.
- Review the migration with a dry run and database advisors.
- Commit the TikTok source before deployment.
- Apply the migration and deploy `tiktok-oauth` plus the new `agent-api` version.
- Complete a real creator authorization in the extension.
- Verify a signed live TikTok product search and user-visible daily feed.

The live project currently has **no deployed `tiktok-oauth` function**. No TikTok migration or function from this in-progress cycle has been deployed. The deliberately established baseline tests remain red until the extension connection work is finished.

## 12. Test and verification history

Major completed verification cycles include:

| Verification | Result |
|---|---|
| 18-case Gmail/media-kit matrix | 15 first-pass successes; exposed meeting fallback and signoff gaps |
| 100-case Gmail/voice/media-kit stress | 61 first-attempt passes; drove multiple targeted fixes |
| 51-case follow-up regression | Boundary gaps fixed; final six-case confirmation passed 6/6 |
| Two 22-case description routing waves | Improved from 20/22 to 22/22 |
| 100-scenario tenant feature matrix | 92/100 first pass; all eight failures passed targeted reruns |
| 25-case live acceptance | Safe sends, drafts, no-reply outcomes, and broad General fallback verified |
| Five-case Auto-sweep acceptance | Safe missing-details, General/Fitness attachments, injection skip, owner-mail skip passed |
| 50-case affiliate benchmark | Improved from 27/50 to 50/50 |
| Five-tab live API matrix | Previously passed 26/26 |
| Local policy/backend/extension suites | Previously passed 90/90 at the referenced milestone |

Detailed evidence is preserved in `docs/audits/`, especially:

- `yafet-100-dynamic-stress-20260724.md`
- `caughtup-live-regression-20260725.md`
- `caughtup-description-kit-routing-20260725.md`
- `caughtup-tenant-100-feature-stress-20260725.md`
- `caughtup-25-live-20260802.md`
- `caughtup-auto-sweep-20260802.md`
- `caughtup-opportunities-v1-20260804.md`
- `caughtup-affiliate-api-20260804.md`
- `caughtup-affiliate-50-stress-20260804.md`
- `caughtup-creator-platform-routing-20260807.md`

Static checks never substitute for live acceptance. A feature is not considered end-to-end complete until its real function response, resulting database/Gmail/provider state, and extension-visible result are verified.

## 13. Current deployed state

The live Supabase function list was checked on August 8, 2026:

| Function | Live version | State |
|---|---:|---|
| `agent-sweep` | 33 | Active |
| `agent-api` | 19 | Active |
| `gmail-oauth` | 5 | Active |
| `daily-digest` | 2 | Active |
| `seed-media-kit` | 3 | Active |
| `stripe-webhook` | 1 | Active, billing dormant |
| `tiktok-oauth` | — | Not deployed |

The current deployed `agent-api` v19 contains the creator-specific relevance, listing-backed platform routing, and daily affiliate allocator. It does not contain the uncommitted TikTok OAuth work.

## 14. Local Git and GitHub state

At the time of this handoff:

- Local branch: `main`
- Local HEAD: `47b02fd docs: record live affiliate routing verification`
- `origin/main`: `25e16cb fix: simplify creator opportunity discovery`
- Local `main` is **four commits ahead** of `origin/main` and zero behind.
- The TikTok implementation is uncommitted.
- The worktree also contains unrelated/user-owned dirty and untracked architecture, agent, audit, and temporary files. They must not be blindly staged or reverted.

Only task-owned files should be explicitly staged. Do not use destructive Git cleanup commands.

## 15. Known open product work

1. Finish, verify, commit, and deploy the TikTok creator connection and product sync.
2. Obtain/confirm TikTok Affiliate API activation, creator allowlisting, and the required creator scope in Partner Center.
3. Decide whether Awin will use an approved live feed/API credential and map only listing-provided promotion channels.
4. Push the four already-committed local changes plus the eventual TikTok commit to GitHub after verification.
5. Perform a signed-in five-tab popup pass in the user's normal Chrome profile.
6. Add durable automated integration fixtures around Gmail recall, safe recovery, attachment previews, edit learning, and signoff behavior.
7. Add real Google Calendar only with explicit OAuth scope and truthful external conflict checks.
8. Configure billing/Stripe and package for the Chrome Web Store only after product behavior is accepted.
9. Rotate credentials previously exposed through chat before public launch.

## 16. Recommended next execution order

```text
Finish extension TikTok connection UI
  -> run targeted TikTok tests
  -> run all local backend/extension checks
  -> inspect migration security and database advisors
  -> commit only TikTok-owned source
  -> dry-run migration
  -> deploy migration + tiktok-oauth + agent-api
  -> verify deployed versions
  -> complete real creator authorization
  -> run signed product search
  -> verify 5–10 relevant products in Opportunities
  -> capture audit evidence
  -> push local commits to GitHub
```

Live acceptance may remain blocked until TikTok approves the Affiliate API and creator authorization scopes for the app. If the platform returns an approval or scope error, CaughtUp should show a reauthorization/configuration state and must not fabricate product data.
