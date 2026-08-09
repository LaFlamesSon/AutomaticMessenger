# CaughtUp (AutomaticMessenger) — current project state

Read this first in a new session. It records the deployed architecture and the
safety posture; prefer it over stale conversation history.

## Product

CaughtUp is a Gmail inbox agent delivered as a Chrome MV3 extension. It can
triage recent unprocessed Inbox mail, prepare reviewable replies in the user's learned voice,
send only through an explicit preview/send flow, attach a matching media kit,
and apply the user's email, phone, or scheduled-call contact preference.

The extension source is version **0.5.2** with five tabs: Today, Opportunities, Kits, Calendar,
and Settings. Calendar currently manages CaughtUp availability and internal
bookings; it does not claim or provide Google Calendar synchronization.
Today interleaves actionable inbox messages and creator negotiations by event
time. Negotiations expose context and a safe proposed reply, use green/yellow/red
threshold states, pin the relevant media kit, and can be dismissed until new
inbound activity resurfaces them. Negotiation messages are always Review-only
even when Auto-send is enabled.
Real Gmail drafts now open in an editable extension review dialog. The creator
can change the bounded reply, replace or remove the single owned media kit, save
those changes back to the same version-checked Gmail draft, and then explicitly
send. Real negotiation cards use this same flow through their linked processed
email; synthetic harness cards remain preview-only.

## Safety posture

- Email content is untrusted data, never agent instructions.
- Auto-send is currently enabled for the production profile's explicitly
  confirmed Urgent and Action needed categories.
- Contact details and scheduling slots come from owner-controlled server state.
- A draft may offer server-verified open slots, but never claim a meeting is
  confirmed, booked, or reserved.
- Calendar/contact changes force Review mode and increment settings version.
- Broad legacy Inbox mail is not a test fixture. Live QA uses exact Gmail IDs.
- Normal sweeps include unread and owner-read Inbox messages from the last
  seven days, but skip a candidate when its thread has a later owner SENT
  message or draft.

## Architecture

- Supabase project: `xkrpxvswdkreglmefuot`.
- Server: Deno Edge Functions + Postgres + Storage + Vault.
- LLM: OpenAI-compatible provider configured by Vault keys
  `ia_llm_base_url`, `ia_llm_model`, and `ia_llm_api_key`.
- Extension auth: a new session requests Supabase Google identity and
  `gmail.modify` in one Google launch. Transient provider tokens are validated
  and matched server-side, never persisted by the extension, and the prior
  separate Gmail consent remains only as a recovery path. A verified Supabase
  JWT authenticates `agent-api`; the legacy per-user API token remains for
  controlled diagnostics.
- Gmail worker auth: `x-agent-secret`; secrets are read through
  `ia_get_config()` from Supabase Vault.
- Media kits: private Storage objects plus owner-scoped metadata. Matching uses
  configured domains, brands, keywords, and bounded description relevance.
  Legitimate collaboration requests can receive a contextual kit without
  explicit attachment wording; one default kit handles unmatched or ambiguous
  requests without guessing between specific kits.

## Deployed Edge Functions

| Function | Version | Purpose |
|---|---:|---|
| `agent-sweep` | 36 | Gmail triage plus durable negotiation detection and final safe draft synchronization for negotiation proposals |
| `agent-api` | 23 | Extension API plus version-checked Gmail draft editing, owned media-kit replacement, mixed Today timeline, negotiation dismissal, and explicit manual send |
| `gmail-oauth` | 5 | Gmail OAuth connection |
| `daily-digest` | 2 | Daily digest delivery |
| `seed-media-kit` | 3 | Controlled media-kit seed utility |
| `stripe-webhook` | 1 | Billing webhook; billing remains dormant until configured |

All functions perform their own request authentication; `verify_jwt=false` at
the platform edge is intentional, not an authorization bypass.

## Database

Core tables include `ia_users`, `ia_gmail_accounts`, `ia_voice_profiles`,
`ia_processed_emails`, `ia_agent_runs`, `ia_draft_edits`, and
`ia_chat_messages`. Media-kit metadata is owner-scoped and Storage objects are
private. Calendar migration `20260721000004_calendar_contact_preferences.sql`
adds `ia_calendar_preferences` and `ia_bookings`.

Migration `20260809210839_creator_negotiation_memory.sql` adds service-role-only
`ia_media_kit_rate_profiles`, `ia_negotiations`, and `ia_negotiation_events`.
The live no-send harness for `yafet2132@gmail.com` is isolated behind three
`qa-negotiation:*` thread IDs with `is_test=true`; it creates no Gmail message,
draft, label, or send. If its active media kit had no rate profile, the harness
added clearly marked temporary demonstration thresholds without overwriting an
existing profile.

Migration `20260809214727_negotiation_timeline_controls.sql` adds proposal and
dismissal memory and three `qa-inbox:*` processed-email fixtures. These are
database-only display records: `draft_created=false`, `auto_sent=false`,
`delivery_status=none`, and no Gmail draft ID. Existing Gmail and Auto-send
state remain untouched.

Calendar rows are service-role only under RLS. Security-definer RPCs use an
empty `search_path`. A GiST exclusion constraint is the authoritative atomic
double-booking guard; API idempotency and owner checks sit above it.

## Operations and live verification

- Scheduled sweep cron is paused during iterative live QA.
- Live QA preserves the user's current Auto-send setting; unattended QA replies
  must stay inside explicitly controlled accounts.
- Runtime model `deepseek-v4-flash` returned valid JSON after the retired
  `deepseek-chat` name caused HTTP 400 failures.
- The current unpacked-extension callback is allowed by both Supabase Auth and
  the encrypted backend allowlist. A real manual extension sweep completed
  after reinstall: a valid sponsorship fixture became `action_needed` and
  produced a safe Gmail draft; a vague fixture became `spam_or_poor_fit`
  without a draft.
- Concurrent overlapping booking attempts produced one success and one 409;
  idempotent retry and cross-owner deletion checks passed.
- Live reply experiments passed email-only, phone, and scheduled-call rules.
- Media-kit upload validation, correct unique selection/attachment, ambiguous
  no-selection, and cleanup passed.
- An 18-case live exact-message stress matrix passed 15 cases. PDF domain,
  PNG brand, JPEG keyword, ambiguous tie, default fallback, owner-read mail,
  owner-handled threads, injection resistance, long natural briefs, and
  email-only postprocessing all worked without any automatic send. Direct
  meeting requests without an explicit email fallback produced no draft in two
  runs, and one of ten drafts omitted the exact configured signoff.
- A 100-case exact-message stress run against `yafet2132@gmail.com` produced
  61 first-attempt passes; one transient failure passed its exact retry. FYI,
  spam, injection, read-mail, owner-handled, duplicate, long-natural-mail,
  configured-style, and extension API safety checks were strong. Persistent
  failures were concentrated in legitimate sponsor/sample/meeting recall,
  safe regeneration after a draft repeats the sender's budget, recent edit
  learning starvation, and unstable preview hashes on attachment-bearing
  drafts. The separate extension suite passed 29/29 live API checks and 34/34
  local UI-contract checks. Full evidence is in
  `docs/audits/yafet-100-dynamic-stress-20260724.md`.
- The follow-up fix cycle ran 51 additional exact-message cases. The first
  targeted wave verified sponsor/meeting recall, safe budget handling, PDF/PNG
  routing, stable attachment previews, manual send preservation, signoff
  enforcement, and recent-edit learning. A 30-case boundary wave passed 28
  immediately, exposing one brief-based recall gap and one provider timeout.
  Repeat testing then exposed natural "needs samples" phrasing. Both language
  gaps were fixed and the final six-case live confirmation passed 6/6.
  Auto-send stayed off, two sends were limited to the controlled QA sender,
  and the original profile was restored after every wave. Evidence is in
  `docs/audits/caughtup-live-regression-20260725.md`.
- Description-aware media-kit routing was verified in two 22-case live waves.
  The first passed 20/22 and exposed short-term (`gym`) normalization and a
  legitimate skincare request misclassified as FYI. After narrow fixes, the
  second wave passed 22/22: fitness/eyelash/skincare descriptions selected the
  intended images, unmatched and ambiguous collaborations selected the general
  PDF, and FYI/injection/scam cases attached nothing. Auto-send remained off
  and all temporary kits/profile changes were restored. Evidence is in
  `docs/audits/caughtup-description-kit-routing-20260725.md`.
- Two exact sent-edit examples produced measurable subsequent voice changes
  without price, availability, commitment, or contact-policy violations.
- A new 100-scenario tenant matrix exercised five media-kit routes, Settings
  and Chat style changes, edit learning, three contact modes, read/handled and
  duplicate behavior, injection/scam handling, stable attachment preview, and
  controlled manual sending. The first pass was 92/100; all eight failures
  passed fresh targeted reruns after fixes. A new hostile-settings-instruction
  boundary then failed once and passed its fresh post-fix confirmation with no
  draft or attachment. The five-tab live API matrix passed 26/26 and the local
  policy/backend/extension suites passed 90/90. Auto-send remained off, four
  sends stayed within the controlled accounts, and all temporary tenant state
  was removed or restored. Evidence is in
  `docs/audits/caughtup-tenant-100-feature-stress-20260725.md`.
- Expired Google Testing-mode refresh tokens exposed a reconnect defect: an
  existing Gmail row caused new provider credentials to be discarded, while a
  failed sweep was returned as an apparent success and Today rendered empty.
  Extension 0.3.5 replaces verified credentials on every consent, offers a real
  reconnect flow, persists that requirement across popup restarts, and surfaces
  `gmail_reconnect_required`. Google onboarding now runs in a durable extension
  page so Chrome cannot destroy the session-saving callback when the toolbar
  popup loses focus. Production verification returned HTTP 422 and recorded that
  exact safe run error.
- Manual sweeps now keep the user-facing action labeled `Sweep now`, persist a
  baseline completion marker, and automatically refresh Today after a timeout or
  popup reopen. Legacy request IDs that could loop forever on `already claimed`
  are discarded. Today no longer renders Low priority or Filtered out aggregate
  rows; those categories remain internal triage outcomes.
- Auto-send activation now starts as soon as the user selects it, defaults an
  empty eligibility choice to Urgent and Action needed, requires a non-empty
  category set server-side, and visibly reports whether confirmation completed.
  Media-kit description matching no longer treats four-letter prefixes such as
  `auto` as evidence for an `automotive` kit; unmatched collaborations use the
  single General fallback. Deployed verification rejected an empty Auto-send
  category set with `auto_categories_required`; an exact Review-mode Gmail
  fixture containing the prior `AUTO` tag selected Yafet General Media Kit.
- Configured Ask-when-missing items are now details the reply gathers rather
  than four simultaneous prerequisites for sending. Safe, high-confidence
  information-gathering replies can auto-send, while deterministic recovery,
  custom rules, unsafe language, low confidence, and ambiguous attachments
  remain Review-only. Generic description words such as `care`, `education`,
  and `design` no longer select unrelated kits. Eight exact live cases on
  `agent-sweep` v30 verified a safe missing-details auto-reply, General fallback
  for pet care/education/social design, positive Automotive and Finance routes,
  an attachment-gated Review draft, and no reply to prompt injection. The one
  automatic reply was self-addressed to `yafet2132@gmail.com`.
- A 25-case exact-message live matrix on 2026-08-02 exercised missing-detail
  replies, current contact policy, 14 specific/general kit requests, unsafe
  budget/acceptance boundaries, prompt injection, FYI, owner-read mail, and
  duplicate isolation. It produced 3 controlled self-addressed sends, 20 live
  drafts, and 2 no-reply outcomes with no unsafe language or external recipient.
  One real gap let the word `beauty` select Eyelash despite an explicitly broad,
  multi-category request. Agent-sweep v31 now routes explicitly general/broad/
  mixed requests to the default kit unless an exact configured sender domain or
  brand overrides it; the fresh live rerun selected Yafet General Media Kit.
  Evidence is in `docs/audits/caughtup-25-live-20260802.md`.
- Extension 0.3.8 makes `Sweep now` report exact sent/Review counts and refresh
  Today with authoritative delivery state. Agent-sweep v32 skips owner-originated
  Inbox messages, replaces low-confidence legitimate model wording with a safe
  deterministic information request, and allows a uniquely matched kit to send
  only when its owner-controlled Auto-attach switch is on. Yafet General Media
  Kit now has Auto-attach enabled. Five deployed Gmail acceptance cases passed:
  safe missing-details, General PDF, and Fitness PNG replies auto-sent to Yafet's
  own controlled Gmail alias; prompt injection produced no reply; owner mail was
  skipped. Evidence is in `docs/audits/caughtup-auto-sweep-20260802.md`.
- Extension 0.3.11 gives successful manual sweeps a green caught-up banner and shows
  an explicit nothing-pending state after sent items are removed from Today's
  pending view. Cached digest, kit, and calendar views render immediately while
  quiet background refreshes run; Settings reuses the already-fetched startup
  profile instead of making a duplicate first-tab request. The experimental
  animated inbox mascot was removed completely after visual review.
- Extension 0.4.0 activates the owner-scoped Opportunities workflow: opt-in
  creator direction, Gmail relationship suggestions requiring confirmation,
  creator-added brands and same-domain HTTPS source URLs, deterministic scoring,
  current media-kit recommendations, save/dismiss state, and Gmail outreach
  drafts with authoritative preview and explicit send. Inbox Auto-send never
  applies to opportunity outreach. Migration `20260805011421` is live; source
  and deployed acceptance evidence is in
  `docs/audits/caughtup-opportunities-v1-20260804.md`.
- Extension source 0.4.1 and `agent-api` v16 add the affiliate-opportunity API:
  owner-scoped category performance metrics, manual affiliate-product ingestion,
  separate match and difficulty rankings, evidence-bounded earnings ranges, and
  media-kit recommendations. Migration `20260805025333` is live; its two new
  tables have RLS enabled and grant direct access only to `service_role`. Provider
  OAuth/catalog sync remains open until approved provider credentials exist.
  Deployment evidence is in
  `docs/audits/caughtup-affiliate-api-20260804.md`.
- A 50-case affiliate opportunity benchmark improved from 27/50 to 50/50 after
  eliminating cross-category metric leakage, loose substring and region matching,
  cross-platform follower borrowing, and false zero-valued earnings evidence.
  `agent-api` v17 is deployed with those matcher fixes. Extension source 0.4.2
  now makes active manual/private sources and the absence of a connected live
  marketplace feed explicit in the Opportunities tab. Evidence is in
  `docs/audits/caughtup-affiliate-50-stress-20260804.md`.
- Extension source 0.4.3 makes Opportunities an affiliate-products-first feed.
  Product cards now show only match, difficulty, commission/earnings, one fit
  reason, the relevant media kit, and actions. Profile, metric, and manual-entry
  controls are collapsed under `Tune your matches`; non-affiliate brand records
  no longer appear in the primary feed. The 400x600 visual pass, 81 source/API
  contracts, and the 50-case matching benchmark remained green.
- Extension source 0.4.7 keeps affiliate-product relevance creator-specific but
  never derives posting-platform instructions from creator performance. Platform
  labels appear only from listing/programme evidence; standard Awin product feeds
  without that evidence show no platform instruction. An atomic server-side daily
  surface operation releases at most ten new relevant, commission-bearing products
  to each creator per configured local day. Both migrations and `agent-api` v19
  are deployed and live-verified; evidence is in
  `docs/audits/caughtup-creator-platform-routing-20260807.md`.

## Repository layout

- `supabase/functions/` — Edge Function sources; deploy only committed code.
- `supabase/migrations/` — database changes; never make ad-hoc schema edits.
- `extension/` — unpacked Chrome/Edge MV3 source.
- `docs/audits/` — closed-loop conditions and QA evidence.
- `context-vault/ops/sessions/` — EA-invoked agent handoffs.
- `web/` and `automessenger/` — marketing prototype and superseded legacy CLI.

## Next product work

1. Perform one signed-in five-tab popup and Calendar pass in the user's normal
   Chrome profile.
2. Add durable automated integration fixtures around the now-live deterministic
   recall, safe-recovery, attachment-preview, learning, and signoff behavior.
3. Add real Google Calendar integration only with explicit OAuth scope and
   truthful external conflict checks.
4. Configure/activate Stripe, host the marketing site, and prepare Web Store
   packaging when product behavior is accepted.
5. Rotate any credentials previously exposed in chat or local logs.
