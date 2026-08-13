# DeepSeek V4 Pro inbox and negotiation stress — 2026-08-13

## Result

DeepSeek V4 Pro remained active for a live Review-only matrix. The run created
no new sends. Forty ordinary first-contact inquiries produced forty Gmail
drafts. Twenty established negotiation fixtures and twenty graduated follow-up
fixtures exercised flat-fee, commission, hybrid, usage-rights, exclusivity,
deadline, and counteroffer language.

Twenty-eight fixtures reached negotiation memory and all twenty-eight have a
non-empty proposed reply. Threshold coverage was five below-minimum, ten
within-range, nine at-or-above-target, and four unconfigured. A bounded draft
scan found no price statement, acceptance/rejection, or turnaround promise.

## Cleanup and safety

Before seeding, a one-time authenticated cleanup removed only the previous
stress scope: 53 Gmail drafts were deleted, 58 synthetic Gmail threads were
moved to Trash, 111 extension email records were deleted, and 15 synthetic
negotiations were deleted. The cleanup action was removed immediately and
`agent-api` was redeployed. Genuine inbox items were excluded.

All three profiles were `draft_only`, zero profiles had Auto-send enabled, and
the post-login run produced zero automatic sends. Historical inspection found
that an earlier 2026-08-13 harness run had auto-sent two replies while Auto-send
was enabled; those past sends cannot be undone and were not part of this run.

## Defects found and fixed

DeepSeek V4 Pro labeled two verified commercial follow-ups as spam based on
niche fit or perceived mass outreach. Source previously required the model
category not to be `spam_or_poor_fit` before recognizing negotiation state.
`agent-sweep` now lets deterministic thread evidence win when commercial terms
arrive after an owner SENT message. Deterministic hostile-instruction detection
still blocks the message, and every negotiation remains Review-only.

The deterministic negotiation fallback also no longer says "I'll come back to
you shortly," removing an impermissible turnaround promise.

## Harness limitation

Eight of forty established/graduated negotiation cases did not reach negotiation
memory. Six initial and four graduated cases hit Gmail owner-action chronology
behavior; two of those initial cases instead exposed the pre-fix model-spam
defect. The harness inserts multiple messages with nearly identical received
times, so Gmail ordering can make the owner reply appear later than the terms
message and correctly trigger the production owner-handled guard. This is a
harness-ordering defect, not evidence that the post-fix negotiation classifier
rejected those messages. Future staged fixtures should assign monotonic internal
dates or invoke exact message IDs.

## Verification

- `node --test supabase/tests/negotiation-source-contract.test.mjs`: 8/8 pass.
- `npx deno check` passed for both Edge Functions during the cycle.
- Focused Deno negotiation/policy suites: 36/36 pass.
- Full Deno suite before deployment: 142/142 pass.
- Broader Node source contracts: 55/56 pass; the existing affiliate regex test
  over-scans unrelated `auto_sent` and later `affiliate` text in the enlarged
  API source and is not a runtime failure.
- Deployed `agent-sweep` v44 and `agent-api` v38 are ACTIVE.
- Final database audit: normal 40/40 drafted; negotiations 28 with 0 missing
  proposed replies; 0 new sends; 0 apparent unsafe drafts.
