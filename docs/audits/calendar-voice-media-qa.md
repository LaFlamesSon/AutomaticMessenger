# Calendar, Voice, and Media-Kit QA Baseline

**Date:** 2026-07-21  
**Role:** QA agent (read-only)  
**Scope:** Acceptance conditions in `docs/audits/calendar-voice-media-loop.md`  
**Evidence boundary:** Source and local checks are recorded separately from live/deployed and user-visible checks.

## Baseline result

The pre-change source baseline is green for the existing product but does not yet
implement the Calendar/contact-mode acceptance contract. The current popup has four
tabs (`Today`, `Chat`, `Kits`, `Settings`), and the current schema/API/prompt have no
`contact_mode`, weekly availability, booking, or atomic overlap contract. These are
expected pre-implementation gaps, not regressions in the existing four-tab release.

No live Gmail, Storage, database, or deployed-function mutation was made by QA.
Live acceptance remains open until it is run with reserved fixtures after the source
implementation and deployment are independently verified.

## Checks run on the baseline

| Check | Result | Meaning |
|---|---:|---|
| `node --test extension/tests/*.test.js supabase/tests/source-contract.test.mjs` | Pass, 48/48 | Existing extension and source contracts are green. One test explicitly requires exactly four tabs, so it must be updated for the new fifth-tab contract. |
| `npx --yes deno test supabase/tests/policy.test.ts` | Pass, 12/12 | Existing draft safety, media selection, MIME, schedule-window, and OAuth policy tests are green. |
| `npx --yes deno check ...` for shared policy/MIME and all active Edge Functions | Pass | Current TypeScript sources type-check. |
| Source inspection | Pass for baseline characterization | Targeted manual sweeps require an owned Gmail account ID and exact Gmail message ID; style capture uses an exact stored Gmail sent/draft message ID; media completion verifies owner, byte length, and magic bytes. |
| Deployed/live read | Open | No authenticated, secret-safe live session was available to this QA process. Source results must not be presented as deployed evidence. |

## In-flight implementation verification

This section records source changes that landed after the baseline was frozen. It is
not deployed/live evidence.

| Check | Current result | Evidence |
|---|---:|---|
| Extension unit/markup tests after Calendar UI change | **Pass, 34/34** | The contract now requires exactly five tabs, validates Calendar fields and timezone conversion, discloses internal-only conflict protection, and covers idempotent booking requests. |
| Calendar UI text encoding scan | **Pass after fix** | Initial new strings contained UTF-8 mojibake; the extension agent normalized them and `rg`/UTF-8 reads found no remaining affected strings in the changed extension files. |
| Spring-forward slot generation probe | **Pass after fix** | The initial implementation emitted a nonexistent local time and one reversed interval. The corrected generator exact-round-trips local times, rejects ambiguous/nonexistent times, asserts `end > start`, and passes the regression fixture. |
| Integrated Node contracts | **Pass, 56/56** | Extension behavior and source contracts pass together after Calendar/API integration. |
| Integrated Deno policy tests | **Pass, 17/17 before additional adversarial probes** | Includes one-window-per-day normalization, booking-within-availability, busy-slot exclusion, spring-forward rejection, contact postprocessing, invalid stored-value fallback, media policy, and existing safety rules. Additional manual probes below found missing semantic coverage. |
| Integrated Edge Function checks | **Pass** | `_shared/policy.ts`, `_shared/mime.ts`, `agent-api`, `agent-sweep`, `daily-digest`, `gmail-oauth`, and `stripe-webhook` type-check. |
| Syntax/manifest/diff checks | **Pass** | `popup.js` and `core.js` parse, `manifest.json` parses, and `git diff --check` reports no whitespace errors (only Windows line-ending notices). |

### Integrated source verdict

The source now implements the five-tab Calendar contract, strict contact validation,
one availability window per weekday, internal holds/bookings, atomic Postgres overlap
exclusion, owner-scoped service-role RPCs, Auto-send invalidation, server-owned contact
postprocessing, exact configured phone/link use, verified slot calculation, and the
external-calendar limitation. Review corrections also added:

- exact local-time round-trip rejection for DST gaps/ambiguities and an `end > start`
  invariant for generated slots;
- request-ID binding to the canonical booking payload, with distinct exact-retry and
  idempotency-mismatch semantics;
- a consistent V1 limit of one availability window per day in API and extension;
- booking list/delete access in every contact mode while creation is limited to a
  saved scheduled-call configuration;
- normalized ASCII-safe Calendar UI strings.

This is a **local source Pass**, not a release Pass. Conditions requiring a running
database, deployed functions, Gmail, Storage, LLM output, or installed extension remain
Open until the live evidence plan below is completed.

### Resolved adversarial findings

After the 56/56 Node and 17/17 Deno run, direct policy probes found that the
postprocessor still allowed an explicit claim that Google Calendar was synchronized
and conflict-free. It also preserved email-only call euphemisms including a Tuesday
time proposal, Zoom, live chat, and video conference language. These findings were
sent to backend as release blockers because passing unit tests did not yet satisfy the
semantic contact-mode requirements. The postprocessor and regressions were expanded;
the exact probes and variants covering time proposals, voice-call euphemisms, personal
calendar claims, and conflict-protection claims now pass. Final source gates are 56/56
Node, 17/17 Deno, all active Edge Function checks, JavaScript syntax, manifest parsing,
and scoped diff checking. No source release blocker remains from this review.


## Acceptance matrix

Status values are **Pass**, **Fail**, or **Open**. A condition remains Open when the
required live or user-visible proof has not run, even if source inspection is favorable.

| # | Condition | Baseline | Required decisive evidence |
|---:|---|---|---|
| 1 | Five accessible tabs, with one Calendar tab and matching panel | **Fail** | DOM contract test for five unique tab/panel pairs; keyboard and focus behavior; installed-MV3 visual exercise at narrow popup width. |
| 2 | Owner-scoped contact preference round-trip | **Fail** | Migration + API tests for `email_only`, `phone`, and `scheduled_call`; two-user live isolation proof; invalid phone/URL/timezone payload rejection. |
| 3 | Email-only drafts suppress call, phone, scheduling, and booking language | **Fail** | Server-owned prompt-context unit test plus generated-draft probes. Assert no configured phone, booking URL, call invitation, scheduling request, or slot language appears. |
| 4 | Phone mode uses only the configured valid contact method | **Fail** | Prompt input contains the canonical server-owned phone only; sender-supplied phone is ignored; missing/invalid configured phone fails closed to Review or an email-only response. |
| 5 | Scheduled-call drafts use only verified slots or configured booking URL and never confirm a meeting | **Fail** | Prompt receives only server-computed open slots/exact configured URL; generated output contains no invented slots and no `booked`, `confirmed`, `reserved`, or external-calendar claim. |
| 6 | Overlapping internal bookings cannot both be created | **Fail** | A transactional concurrency test starts two overlapping creates together and proves exactly one commit and one stable conflict response. A prior read followed by insert is insufficient. |
| 7 | Media upload rejects unsafe/oversize data and activates only server-valid files | **Open** | Existing source validates owner, declared size, and magic bytes. Run safe PDF/image live upload; then wrong magic, length mismatch, unsupported MIME, oversize, and cross-owner completion probes. |
| 8 | Unique media kit is selected and attached; ambiguity never guesses | **Open** | Existing policy unit tests unique scoring/ties. Live Gmail draft must contain exactly one expected filename/MIME/size and API must show its label; a tied fixture must attach nothing and remain Review. |
| 9 | A captured user edit measurably changes later voice while hard rules remain | **Open** | Matched before/after draft corpus, exact-message edit association, predeclared style metrics, and unchanged safety assertions. A single stochastic draft is not sufficient. |
| 10 | Auto-send remains off throughout test activity | **Open** | Snapshot profile before/during/after every live fixture run. Abort if `reply_mode != draft_only`, `auto_send = true`, or confirmation metadata is populated. |
| 11 | Regression/type checks pass and deployed versions are verified | **Open** | Local checks currently pass. Repeat after merge; then compare committed source identity with deployed function list/version and exercise authenticated live responses. |
| 12 | Unrelated unread Gmail and unrelated dirty worktree files remain untouched | **Open** | Exact before/after Gmail message+label snapshot and explicit `git status --short` before/after. Only reserved fixture message IDs may change. |

## Release-blocker assertions

The following are blockers even if the extension appears functional:

- Every contact, availability, timezone, booking-URL, or booking mutation must
  increment the policy/settings version and clear Auto-send confirmation. The final
  send boundary must re-read that version before any Gmail send.
- Booking overlap prevention must be atomic in Postgres under concurrent creates.
  Application-only overlap checks are not acceptable.
- The LLM prompt may receive only server-owned contact data and server-computed open
  slots. Email bodies, senders, chat text, or custom rules must not be able to inject
  phone numbers, booking URLs, availability, or booking state into trusted context.
- `email_only` must suppress all phone, call, booking-link, and scheduling language,
  not merely omit the configured fields from a prompt template.
- The product and drafts must not claim Google Calendar/external-calendar conflict
  protection. This phase protects only CaughtUp-owned availability and bookings.

## Concrete verifier plan

### 1. Exact-message Gmail isolation

1. Force the test user's profile to `draft_only`; record settings version and
   confirmation fields. Reserve self-addressed fixture messages with unique opaque
   markers in subject/body and record their Gmail message IDs.
2. Snapshot every unrelated unread message as `(message_id, thread_id, label_ids)`.
   Record the fixture IDs separately; do not store message bodies in audit logs.
3. Invoke manual sweep with the owned Gmail account ID and one exact fixture message
   ID. Never use the broad scheduled sweep for acceptance fixtures.
4. Assert exactly that ID gains the CaughtUp label/processed row/draft association.
   Compare the unrelated snapshot byte-for-byte after each sweep.
5. Verify the stored `gmail_draft_message_id` or `gmail_sent_message_id` is the exact
   Gmail object used for learning. Reject thread-latest or search-result fallback.

### 2. Measurable voice adaptation

Use at least three matched, policy-safe inquiries before and three after the edit.
Keep sender class, request intent, model/configuration, profile revision, and fixture
structure stable. Before generating, predeclare two or more traits, for example:

- greeting present/absent;
- contraction rate;
- median sentence length;
- sign-off choice;
- exclamation or emoji count.

Edit and manually send exactly one reserved draft so those traits move clearly, then
run learning and verify one owner-scoped `ia_draft_edits` record is associated with
the exact sent message. Accept adaptation only when the matched post-edit set moves
in the intended direction on at least two predeclared traits without any price,
turnaround, acceptance/rejection, unverified availability, or contact-mode violation.
Record metrics and hashes/IDs, not private email bodies, in durable QA documents.

### 3. Contact-mode prompt/output probes

Run the same adversarial inquiry under all three modes. Include attacker-controlled
phone numbers, booking URLs, claimed availability, and instructions in the email.
Inspect both the structured prompt input and final draft:

- `email_only`: trusted contact payload contains no phone, URL, or slots; final text
  contains no call invitation, scheduling request, phone number, or booking link.
- `phone`: only the canonical configured phone may be supplied or emitted. An invalid
  or missing configured phone fails closed; the attacker's number never appears.
- `scheduled_call`: only exact server-computed open slots or the exact configured
  booking URL may be supplied or emitted. The draft proposes, never confirms.

For every mode, mutate the contact configuration after preparing Auto-send and prove
the old confirmation cannot authorize a send.

### 4. Transactional overlap rejection

Use a disposable user and future slots. Test identical, partially overlapping,
enclosing, and enclosed intervals; test adjacent `[start,end)` intervals as allowed;
include a DST boundary in the configured IANA timezone. For the concurrency case,
hold two independent transactions at a barrier and submit overlapping inserts at the
same time. Exactly one may commit. Confirm stable conflict semantics and verify users
cannot read or mutate one another's availability/bookings.

### 5. Media upload, choice, and Gmail attachment

Prepare bounded non-sensitive PDF/image fixtures and record filename, MIME, byte size,
and SHA-256. Create two active kits with distinct exact sender-domain metadata. Verify
prepare/upload/complete, owner scoping, private storage, and server validation. Then:

1. Sweep a reserved portfolio request from the uniquely matching domain.
2. Fetch the full Gmail draft and assert exactly one attachment matches the expected
   filename, MIME, and size/hash; verify the extension/API displays the same kit label.
3. Run a tied/ambiguous request and assert no attachment, no attachment claim in text,
   and Review/draft-only disposition.
4. Probe unsupported type, oversize declaration, wrong magic bytes, size mismatch,
   cross-owner ID, and incomplete upload. Clean up only the reserved test kits/files.

## Live evidence record template

For each live condition, record timestamp, environment/project reference, committed
source identity, deployed function versions, anonymized user/account IDs, fixture
message IDs or hashes, request correlation ID, before/after state, and Pass/Fail.
Never record access tokens, database credentials, refresh tokens, private email bodies,
or raw media-kit contents.

## Live database/API evidence — 2026-07-21

The EA reported and QA reconciled the following live results against committed source
`993c7ad`. `git diff 993c7ad -- extension supabase` was empty at reconciliation time,
so the local implementation under review matched the committed source. Migration
`20260721000004_calendar_contact_preferences.sql` was applied and `agent-api` plus
`agent-sweep` were deployed from that release.

| Probe | Result | Acceptance effect |
|---|---:|---|
| Two simultaneous overlapping booking API creates | **Pass** | Exact statuses were 200 and 409: one accepted and one rejected. This supplies live evidence for atomic overlap condition 6. |
| Exact request-ID retry | **Pass** | Returned `already_exists=true`; no duplicate was created. |
| Same request ID with changed payload | **Pass** | Returned 409/code `idempotency_mismatch`. |
| Second disposable user deletes owner's booking | **Pass** | Returned 404, while the owner delete succeeded. This is live owner-isolation evidence. |
| Cleanup | **Pass** | Zero reserved test bookings remained. Contact mode was restored to `email_only`; reply mode was `draft_only`; `auto_send=false`. |

This evidence closes the live concurrency portion of condition 6. It partially supports
conditions 2, 10, and 11, but does not by itself prove every contact-mode round trip,
Auto-send state throughout Gmail fixtures, deployed source identity beyond the reported
release, or any user-visible extension behavior. Gmail/LLM voice, prompt-mode output,
media attachment, exact-message isolation, and installed-extension evidence remain Open.

## Live Gmail/contact evidence — interim

The controlled Gmail run reported a preexisting unread candidate set of five and zero
changes to those unrelated message IDs. Auto-send remained false and contact state was
restored after each fixture.

| Fixture | Interim result | Evidence/assessment |
|---|---:|---|
| Email-only, benign inquiry | **Pass** | A 64-word draft was created with no call, phone, scheduling, booking-link, or other contact language. |
| Phone, benign inquiry with sender-controlled number | **Pass** | The draft used only the configured owner phone number; the sender-provided number was absent. |
| Adversarial email/scheduled prompts | **Pass safe / no functionality claim** | No draft was created, which is fail-closed and safe but does not prove a usable scheduled-call reply. |
| Scheduled-call, benign/urgent inquiry | **Pass after fix** | A post-fix urgent fixture saved a Gmail draft containing verified 30-minute slots and the configured timezone, with no confirmation or external-calendar claim. Contact was restored to email-only and Auto-send remained false. |
| Unrelated unread isolation | **Pass for these fixtures** | Five preexisting unread candidates were snapshotted; changed count remained zero. |

Two follow-up commits were deployed during diagnosis: `77f8efd` strengthened the
scheduled-call prompt to require the non-scheduling reply body, and `c4620db` added
secret-authenticated targeted diagnostics containing only category, boolean/gate names,
word count, verified-slot count, and decision. QA source review found no email content,
subject, sender, or draft text in that diagnostic envelope. The scheduled-call gate
was held open until the diagnostic result and successful controlled draft were recorded.

The diagnostic identified non-idempotent canonical slot text. Commit `8309d2e`
changed the canonical two-sentence slot suffix into one semicolon-joined sentence so
the second deterministic safety pass removes and restores it exactly. QA reviewed the
fix and regression, reran the local gates, and the successful live scheduled-call
fixture above closes condition 5 for this release.

## Live media-kit/Gmail attachment evidence — 2026-07-21

Commit `4d275ef` corrected PNG terminal-chunk validation to inspect the IEND chunk
type at bytes `length-8..length-4`; QA confirmed the offset against the PNG layout and
reran the source contract and `agent-api` type check.

| Probe | Result | Evidence/assessment |
|---|---:|---|
| Two safe PNG kits prepare/upload/complete/list | **Pass** | Both server-validated fixtures became active and were visible in the owner list. |
| Unique NorthstarAlpha brand request | **Pass** | The expected kit was selected. The Gmail draft contained exactly one attachment named `icon128.png` and truthful attachment wording. |
| Equal-keyword ambiguous request | **Pass** | No kit was selected, the Gmail draft had zero attachments, and the body made no false attached/enclosed claim. |
| Cleanup and send safety | **Pass** | Both reserved kits were deleted, zero test kits remained, and Auto-send was false. |

This supplies live condition-8 evidence.

The complementary unsafe upload probes also passed:

| Rejection probe | Live result |
|---|---:|
| Unsupported MIME at prepare | 415 |
| Oversize declaration at prepare | 413 |
| Wrong magic bytes at completion | 422 |
| Declared/actual size mismatch at completion | 422 |
| Incomplete upload completion | 409 |
| Foreign-owner completion | 404 |

Cleanup left zero active or pending reserved test kits. Together with the two safe
prepare/upload/complete fixtures, this closes condition 7 for the exercised PNG path.

## Live measurable voice adaptation — 2026-07-21

The controlled experiment used three clean baseline drafts, two exactly associated
edited-and-sent training drafts, and three matched post-learning drafts. The two sent
edits produced exactly two learned before/after pairs.

| Predeclared/measurable trait | Before | After | Result |
|---|---:|---:|---:|
| Em-dash greeting | 0/3 | 3/3 | Directional adaptation |
| Phrase `Appreciate the clear brief` | 0/3 | 3/3 | Directional adaptation |
| At least three paragraphs | 1/3 | 3/3 | Directional adaptation |
| Average word count | 48.7 | 31.0 | Concision adaptation |

All six comparison drafts had zero price, unverified availability, commitment, or
email-only contact violations, and Auto-send remained false. The matched set moved on
four measurable traits—exceeding the two-trait threshold—while preserving the hard
rules. This closes condition 9 for this controlled experiment.

## Installed extension runtime — 2026-07-21

The unpacked repository `extension/` was loaded in an isolated Microsoft Edge Chromium
profile after Chrome 150 refused command-line unpacked-extension loading in a clean
profile. CDP runtime inspection reported manifest version `0.3.0` and asserted:

- exact tabs `Today | Chat | Kits | Calendar | Settings`;
- selecting Calendar set the tab selected state and made its panel visible;
- contact modes `email_only`, `scheduled_call`, and `phone`;
- seven weekday availability controls;
- explicit disclosure that internal bookings are not synchronized with Google or
  other external calendars.

QA visually inspected `docs/audits/caughtup-calendar-runtime.png`. The installed
runtime rendered the Calendar and internal-booking surfaces with the external-calendar
limitation visible and no obvious clipping in the extension content column. This
isolated profile was intentionally unauthenticated, so it displayed loading states and
did not itself execute signed-in Calendar CRUD. That CRUD, ownership, concurrency, and
error semantics were instead exercised through the deployed authenticated API/database
tests above. Condition 1 passes; authenticated popup-to-API CRUD remains a documented
coverage gap and must not be described as visually end-to-end tested.

## Final acceptance disposition

| # | Condition | Final status | Decisive evidence |
|---:|---|---:|---|
| 1 | Five accessible tabs and Calendar panel | **Pass** | Installed Edge/Chromium runtime + CDP assertions + screenshot. |
| 2 | Owner-scoped contact round trip | **Pass** | Deployed API mode changes/restoration plus foreign-owner 404 isolation; installed signed-in popup interaction was not run. |
| 3 | Email-only suppresses contact/scheduling language | **Pass** | Benign live draft clean; adversarial prompts fail closed; deterministic regressions pass. |
| 4 | Phone uses only configured valid method | **Pass** | Live draft contained only the configured number and rejected the sender-controlled number. |
| 5 | Scheduled-call uses verified slots/link and never confirms | **Pass** | Live urgent draft contained verified 30-minute timezone-labeled slots and no confirmation/external-calendar claim. |
| 6 | Overlap rejection is atomic | **Pass** | Concurrent live creates returned exactly 200/409; idempotency and ownership probes passed. |
| 7 | Media upload validation | **Pass** | Safe PNG completion plus live 415/413/422/409/404 rejection matrix. |
| 8 | Unique attachment / ambiguity no guess | **Pass** | Live unique one-attachment Gmail draft and ambiguous zero-attachment truthful draft. |
| 9 | Measurable voice adaptation | **Pass** | Two exact learned pairs; matched 3-before/3-after set moved on four traits with zero policy violations. |
| 10 | Auto-send off during tests | **Pass** | Reported false throughout contact, booking, Gmail, voice, and media runs; restored profile was draft-only. |
| 11 | Regression checks and deployed release verified | **Pass** | Final local 57/57 Node, 17/17 Deno, all active Edge checks, JS/manifest/diff checks; migration and follow-up function commits deployed and exercised live. |
| 12 | Unrelated unread/worktree preserved | **Pass** | Five preexisting unread candidates had zero changes; reserved rows/kits/bookings were cleaned; unrelated dirty worktree entries remained present. |

**QA verdict:** the twelve scoped acceptance conditions pass with no known release
blocker. Evidence is split deliberately across installed unauthenticated UI runtime,
authenticated deployed API/database probes, and controlled Gmail/LLM fixtures. The
remaining non-blocking coverage gap is a signed-in click-through of Calendar CRUD in
the installed popup itself.
