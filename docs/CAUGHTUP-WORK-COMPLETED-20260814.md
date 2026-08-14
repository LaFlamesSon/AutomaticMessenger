# CaughtUp Work Completed

Updated: August 14, 2026

Repository: `C:\Users\yafet\AutomaticMessenger`

Branch: `main`

Recorded commit: `df5c0fe84599c7cbfb7c9e7bf2d7228f816c68ee`

This handoff records the work completed during the August 13-14 transition from broad Gmail access to a send-only Gmail integration with forwarding-based inbox intake. It intentionally contains no passwords, OAuth secrets, refresh tokens, API tokens, or Vault secret values.

The continuation plan is in [CAUGHTUP-NEXT-STEPS-20260814.md](./CAUGHTUP-NEXT-STEPS-20260814.md).

## Continuation update: local send-only cleanup candidate

The next work session completed the local source package described in Phases 0,
1, 2, and 3 of the continuation plan. This is a local release candidate until
the retirement migration and Edge Functions are explicitly authorized for
production deployment.

- Aligned the three forwarding-acceptance migration filenames with their
  already-applied remote timestamps; the CLI now reports each pair aligned and
  does not propose re-executing their SQL.
- Added `20260814051952_retire_inbox_sweep.sql`, guarded by a zero-`inbox_read`
  check, to unschedule `inbox-agent-sweep` and remove `inbox_read` from the
  runtime capability constraint.
- Converted `agent-sweep` to an inert HTTP 410 boundary.
- Removed Gmail Draft/read/fixture actions from `agent-api`. Active functions now
  use Gmail data APIs only through `users.messages.send`.
- Disabled dormant Opportunities draft/send actions pending a send-only relaunch.
- Added forwarding onboarding, controlled Review/Auto-send test status, and
  intake-disconnect guidance to the extension; bumped the local manifest to
  `0.6.1`.
- Updated the homepage, privacy policy, support page, OAuth submission notes,
  canonical snapshot, and historical-doc warnings to describe forwarding plus
  CaughtUp-stored drafts.
- Audited all nine downloadable policy PDFs by extracted text. None described
  Gmail read, label, settings, or Gmail Draft API access, so regeneration was
  not required.
- Local verification passed: 56 backend contract tests, 51 extension tests,
  JavaScript syntax checks, and Deno type checks for the four touched Edge
  Functions.

Not completed by this local candidate: production deployment/migration, OAuth
secret rotation, real external forwarding and send acceptance, Google Cloud
console alignment, clean-grant recording, demo video, or verification
resubmission. Those actions require explicit authorization and/or user-controlled
accounts.

## Executive summary

CaughtUp now has a working production path that does not request `gmail.modify`, `gmail.readonly`, or `gmail.compose`:

```text
Gmail forwarding
  -> Cloudflare Email Routing Worker
  -> signed Supabase inbound-email request
  -> classification/drafting/negotiation state
  -> CaughtUp Today view
  -> Gmail users.messages.send
```

Google identity and Gmail authorization are separated. Supabase Google login requests identity. A separate production OAuth flow requests identity plus `gmail.send`, verifies that the Gmail address matches the signed-in CaughtUp identity, and stores a send-only refresh token server-side.

The forwarding pipeline and send-only outbound path are deployed. A controlled production acceptance run proved that an Action needed reply could be generated and automatically sent through Gmail to the connected account. Negotiations remain Review-only even while Auto-send is enabled.

## Current production snapshot

Snapshot taken August 14, 2026:

| Item | Current state |
|---|---|
| Supabase project | `xkrpxvswdkreglmefuot` |
| Extension manifest version | `0.6.0` |
| Production branch | `main` at `df5c0fe` |
| GitHub | `origin/main` matched local `HEAD` when this work closed |
| Gmail authorization | One `send_only` account |
| Legacy Gmail authorization | One `legacy_disabled` account; no `inbox_read` account |
| Forwarding | One active forwarding alias |
| Reply mode | `auto_send` |
| Auto-send | Enabled for `urgent` and `action_needed` |
| Settings version | `112` |
| Forwarded messages sent | One controlled acceptance reply |
| Gmail Vault configuration names | `ia_google_send_client_id`, `ia_google_send_client_secret` |
| Scheduled jobs | Daily digest active; legacy inbox sweep cron still active but has no eligible `inbox_read` account |

The OAuth client secret was previously pasted into conversation history. Its value is not reproduced here. Rotation remains required before launch.

## Deployed Edge Functions

| Function | Version | State | Notes |
|---|---:|---|---|
| `agent-api` | 45 | Active | Extension API, forwarding setup, CaughtUp draft review/send, safe Auto-send acceptance mode |
| `inbound-email` | 4 | Active | Signed forwarding ingestion, triage, drafting, negotiation promotion, Auto-send |
| `gmail-oauth` | 6 | Active | Send-only Gmail OAuth callback and verified-email ownership check |
| `agent-sweep` | 46 | Active | Legacy inbox reader; restricted to `inbox_read` accounts, of which there are currently none |
| `daily-digest` | 3 | Active | Digest email sent through send-only Gmail account |
| `gmail-send-probe` | 4 | Active/retired behavior | Returns HTTP 410 and cannot send |
| `seed-media-kit` | 3 | Active | Controlled media-kit utility |
| `stripe-webhook` | 1 | Active/dormant | Billing is not configured for launch |
| `tiktok-oauth` | 1 | Active/pending approval | TikTok Creator integration is not generally available |

All listed functions implement their own authentication. Their `verify_jwt=false` platform setting is intentional and is not an unauthenticated application path.

## Work completed

### 1. DeepSeek V4 Pro evaluation and activation

- Compared the existing low-cost DeepSeek V4 Flash behavior with DeepSeek V4 Pro.
- Verified that `deepseek-v4-pro` returned valid non-thinking JSON through the OpenAI-compatible runtime.
- Verified stronger forced-instruction handling than the Flash run.
- Kept email content classified as untrusted data.
- Confirmed the retired `deepseek-chat` model name returned HTTP 400 and should not be restored.
- Recorded the runtime model in the project state documentation.

Relevant commit:

- `7c314d2` — Record DeepSeek V4 Pro stress results and auth boundary

### 2. Negotiation visibility and creator-first promotion

- Preserved verified negotiations even if a later model result attempted to classify the message as spam.
- Kept first-contact brand messages as ordinary inbox items.
- Required a creator-sent reply in the same CaughtUp thread before a later commercial-terms message starts negotiation memory.
- Allowed an already-active negotiation to remain active on subsequent messages.
- Forced all negotiation replies to Review mode, even when Auto-send is enabled.
- Linked forwarded replies using RFC `Message-ID`, `In-Reply-To`, and `References` headers.
- Added regression coverage for the creator-first transition and reply-chain lookup.

Relevant commits:

- `1b2aae1` — Never hide verified negotiations on model spam judgment
- `a8a14c0` — Lock forwarded negotiation reply flow

### 3. Supabase sign-in persistence

- Diagnosed Supabase login persistence separately from Gmail OAuth persistence.
- Found that the extension had many sessions but no recorded refreshes, identifying refresh coordination rather than Google publishing status as the active defect.
- Made the MV3 background service worker the single owner of rotating refresh-token exchanges.
- Recreated the refresh alarm whenever the service worker loads.
- Preserved recoverable sessions on transient startup or refresh failures.
- Prevented the popup and background worker from independently consuming the same rotating refresh token.
- Kept terminal refresh failures distinct from temporary network/provider failures.

Relevant commits:

- `35e0116` — Serialize auth refresh and isolate stress fixtures
- `8ca176a` — Update extension version contract
- `93b68d2` — Record persistence root cause and deployed safety gate

### 4. Gmail send-only OAuth transition

- Replaced the production Gmail authorization request with:
  - `openid`
  - `email`
  - `profile`
  - `https://www.googleapis.com/auth/gmail.send`
- Added a separate production OAuth client configuration stored through Vault-backed names.
- Required the callback to receive `gmail.send` and rejected an authorization response that lacked it.
- Matched the verified Gmail address against the signed-in CaughtUp account before saving credentials.
- Added the `oauth_capability` state model:
  - `legacy_disabled`
  - `send_only`
  - `inbox_read`
- Marked pre-transition Gmail credentials `legacy_disabled`.
- Restricted the old sweep worker to explicit `inbox_read` accounts.
- Confirmed the live account is `send_only` and no live account is `inbox_read`.
- Removed the temporary production send probe after it completed acceptance; the endpoint now returns HTTP 410.
- Verified that the extension manifest requests only `storage`, `identity`, and `alarms`, with the Supabase project as its only host permission.

Relevant commits:

- `b5bc7d3` — Test gmail.send OAuth client safely
- `6905c68` — Restore probe login without Gmail read scope
- `4283749` — Allow signed browser Gmail send probe
- `c0a6c1f` — Retire completed Gmail send probe
- `b2802ef` — Replace Gmail modify OAuth with send-only access
- `425cc3e` — Document send-only Gmail production versions

Primary migration:

- `20260814024512_gmail_send_only_oauth.sql`

### 5. Forwarding-based automatic inbox intake

- Created a unique per-user forwarding alias under `inbound.getcaughtup.io`.
- Added a guided setup flow in extension Settings:
  - create/copy forwarding address;
  - open Gmail forwarding settings;
  - detect Google's verification message;
  - expose Google's confirmation link/code;
  - activate the CaughtUp intake state.
- Added a Cloudflare Email Routing Worker that:
  - buffers the MIME stream once;
  - parses the message with PostalMime;
  - forwards a minimized JSON payload rather than raw HTML or full MIME;
  - signs the exact timestamp and body using ECDSA P-256;
  - sends the signed request to `inbound-email`.
- Added Supabase signature verification with a five-minute freshness bound before alias lookup.
- Restricted Gmail forwarding confirmation handling to Google's exact forwarding sender and an allowlisted `mail-settings.google.com` confirmation URL.
- Added bounded storage, a daily intake budget, deduplication, retry reclamation for stale/error rows, and raw-body erasure after processing.
- Added owner/account scoping and service-role-only RLS access to all forwarding tables.
- Updated the extension so Refresh reloads processed state instead of attempting a Gmail inbox read.

Relevant commits:

- `d75cfe7` — Automate Gmail intake with forwarding
- `65c0025` — Harden inbound forwarding storage

Primary migrations:

- `20260814032552_inbound_forwarding_pipeline.sql`
- `20260814041500_inbound_forwarding_post_deploy_hardening.sql`

### 6. Forwarded message processing and CaughtUp drafts

- Reused the established classification, voice, contact preference, media-kit matching, and draft safety policies for forwarded mail.
- Stored forwarded reply drafts inside CaughtUp rather than Gmail Drafts.
- Added owner-scoped actions to:
  - retrieve the current CaughtUp draft;
  - edit it with an authoritative preview fingerprint;
  - select, replace, or remove one owned media kit;
  - explicitly send the reviewed version through Gmail.
- Rechecked word count, safety violations, attachment ownership, draft version, delivery state, and idempotency immediately before sending.
- Added `sending`, `sent`, `failed`, and `reconcile` handling so uncertain Gmail outcomes are not blindly retried.
- Used `users/me/messages/send`, not Gmail draft endpoints, for the forwarded path.
- Added an outbound RFC message ID so a brand reply can be mapped back to the internal CaughtUp thread.

### 7. Safe forwarding acceptance harness

- Added one-use forwarding test runs with hashed test tokens and expiry.
- Kept test messages isolated under `fwd-test:*` thread IDs.
- Limited setup tests to controlled destinations.
- Blocked every manual attempt to send an ordinary test draft with `test_send_blocked`.
- Added a direct-inbound option after self-addressed Gmail messages proved unreliable as a Gmail-forwarding test source.
- Verified a test card appeared in Today as:
  - `Inbox • Action needed`
  - sender `CaughtUp Brand Test <test@inbound.getcaughtup.io>`
  - subject `Potential product collaboration`
- Verified its raw inbound body was erased after processing.

Relevant commits:

- `7d4b4bb` — Add safe forwarding acceptance flow
- `239d963` — Allow direct inbound pipeline verification
- `87365c7` — Isolate forwarding acceptance test threads

Primary migrations:

- Local `20260814042435_forwarding_acceptance_test.sql`
- Local `20260814043647_allow_forwarding_acceptance_test_threads.sql`

### 8. Controlled Auto-send acceptance

- Confirmed the user explicitly enabled Auto-send for Urgent and Action needed.
- Extended the one-use test harness with an Auto-send mode that is permitted only when:
  - the production profile is currently and explicitly in Auto-send mode;
  - the test is the single allowed Auto-send test for that hour;
  - the generated reply recipient is forced to the connected owner's Gmail address;
  - the ordinary draft/manual-send test guards remain active.
- Committed source before applying the migration and deploying the functions.
- Deployed `agent-api` v45 and `inbound-email` v4.
- Triggered one authorized production acceptance test:
  - test ID `57aa6392-8a55-4d11-bb40-18f7a240cee7`;
  - classified `action_needed`;
  - `delivery_status=sent`;
  - `auto_sent=true`;
  - `sent_via=auto`;
  - `human_review_required=false`;
  - Gmail message IDs recorded for both the processed message and send attempt;
  - no send-attempt error;
  - recipient forced to `yafet2132@gmail.com`;
  - inbound raw-body length reduced to zero after processing.
- Confirmed Auto-send remained enabled after the run.
- Confirmed the deployed negotiation override still forces Review.

Relevant commit:

- `df5c0fe` — Exercise forwarding Auto-send safely

Primary migration:

- Local `20260814045104_forwarding_auto_send_acceptance.sql`

## Verification completed

The final local checks run after deployment were:

- `node --test supabase/tests/*.test.mjs` — 69 passed, 0 failed.
- `node --test extension/tests/core.test.js extension/tests/markup.test.js` — 54 passed, 0 failed.
- `node --check extension/popup.js` — passed.
- Production function-source retrieval confirmed the deployed Auto-send harness, self-recipient lock, send-only Gmail call, and negotiation Review override.
- Read-only production SQL confirmed the forwarding test, processed-email row, send-attempt row, Auto-send policy, Gmail IDs, and raw-body erasure.

Deno was not installed locally, so no local `deno check` was run. Supabase successfully bundled and deployed both functions, and the live acceptance path executed successfully.

## Commits from this work period

The following commits were on `main` and pushed to GitHub:

| Commit | Summary |
|---|---|
| `1b2aae1` | Never hide verified negotiations on model spam judgment |
| `7c314d2` | Record DeepSeek V4 Pro stress results and auth boundary |
| `35e0116` | Serialize auth refresh and isolate stress fixtures |
| `8ca176a` | Update extension version contract |
| `93b68d2` | Record persistence root cause and deployed safety gate |
| `b5bc7d3` | Test gmail.send OAuth client safely |
| `6905c68` | Restore probe login without Gmail read scope |
| `4283749` | Allow signed browser Gmail send probe |
| `c0a6c1f` | Retire completed Gmail send probe |
| `b2802ef` | Replace Gmail modify OAuth with send-only access |
| `425cc3e` | Document send-only Gmail production versions |
| `d75cfe7` | Automate Gmail intake with forwarding |
| `65c0025` | Harden inbound forwarding storage |
| `7d4b4bb` | Add safe forwarding acceptance flow |
| `239d963` | Allow direct inbound pipeline verification |
| `87365c7` | Isolate forwarding acceptance test threads |
| `a8a14c0` | Lock forwarded negotiation reply flow |
| `df5c0fe` | Exercise forwarding Auto-send safely |

## Important safety properties preserved

- Email content is untrusted data and never agent instructions.
- Drafts may not contain prices, availability, turnaround, acceptance, rejection, or other commercial commitments.
- Negotiations are always Review-only.
- Auto-send is permitted only after explicit user confirmation and only for selected categories.
- Test records cannot be manually sent.
- Send attempts are idempotent and uncertain Gmail outcomes enter reconciliation instead of blind retry.
- Secrets remain server-side and are never returned to the extension.
- Forwarding tables and message state are service-role-only under RLS.
- Raw forwarded bodies are erased after processing.
- User calls use a verified Supabase session; worker calls use signed or secret-authenticated boundaries.

## Known incomplete or stale areas

These are not claims of completed work:

- The exact external path `other mailbox -> Gmail inbox -> Gmail automatic forwarding -> CaughtUp` has not yet been proven. The acceptance test used the inbound alias directly because self-addressed Gmail did not trigger Gmail forwarding reliably.
- A real forwarded card has not yet been manually sent to a controlled external mailbox.
- A live three-message creator-first negotiation chain has not yet been completed.
- The current Auto-send acceptance did not include a media-kit attachment.
- `agent-api` still contains legacy Gmail Draft read/create/update/send endpoints used by old rows, synthetic negotiation fixtures, and dormant Opportunities behavior. Those endpoints are incompatible with a send-only token and must be removed or converted.
- `agent-sweep` and its cron remain deployed even though no account has `inbox_read` capability.
- The public privacy and support pages still describe Gmail message, label, and Gmail Draft access from the old architecture.
- An older handoff document still mentions `gmail.modify`.
- `CLAUDE.md` contains stale extension/function versions and says Auto-send is off; the live profile is now Auto-send on.
- The extension does not yet expose the new one-click Auto-send acceptance harness as normal product UI.
- Forwarding disconnect exists server-side but is not a complete user-facing Gmail cleanup flow.
- Google Cloud Console scope alignment, clean-grant recording, and the revised verification submission remain user/console work.
- The OAuth client secret exposed in prior conversation history has not been verified as rotated.

## Migration history warning

Do not run a normal database migration push until this is reconciled.

Three migrations were created locally and later applied through the Supabase management connector. The remote history used server-generated timestamps rather than the local filename timestamps:

| Migration name | Local version | Remote version |
|---|---:|---:|
| `forwarding_acceptance_test` | `20260814042435` | `20260814042820` |
| `allow_forwarding_acceptance_test_threads` | `20260814043647` | `20260814043733` |
| `forwarding_auto_send_acceptance` | `20260814045104` | `20260814045411` |

The schemas are live and the migration names are correct, but `supabase migration list` reports each local version as missing remotely and each remote version as missing locally. Reconcile the history deliberately before creating or pushing another migration. Do not reapply the SQL blindly.

## Workspace state warning

The repository contains numerous unrelated modified and untracked files that predate these two handoff documents. They belong to the user and were intentionally preserved. Future work must stage files explicitly and must not use destructive reset or checkout commands.
