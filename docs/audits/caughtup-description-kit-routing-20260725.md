# CaughtUp description-aware media-kit routing — 2026-07-25

## Outcome

Media-kit descriptions now influence actual Gmail draft attachments. A
legitimate collaboration can receive a relevant kit even when the sender does
not explicitly say “attach” or “media kit.” When no specific kit wins, or
specific descriptions tie, the single default/general kit is attached instead
of guessing.

The production worker is `agent-sweep` v23.

## Selection policy

Specificity order:

1. Exact configured sender domain.
2. Exact configured brand name.
3. Configured keyword.
4. Unique bounded description relevance.
5. One default/general kit.

Descriptions are tokenized deterministically, ignore generic collaboration and
media-kit words, normalize simple plurals, and support meaningful three-letter
terms such as `gym`. Description and default matches are never eligible for
unattended sending; they remain Review drafts.

The attachment trigger accepts either:

- an explicit request for a media kit, portfolio, samples, or examples; or
- a legitimate collaboration/partnership request with a real ask.

Explicit FYI/no-response language, prompt injection, and credential/scam
language fail closed and receive no attachment.

## Local gates

- Policy tests: 25/25 passed.
- Backend source-contract tests: 28/28 passed.
- Extension core and markup tests: 34/34 passed.
- Total automated checks: 87/87 passed.
- `agent-sweep` and `agent-api` passed Deno type checking.
- Extension JavaScript syntax and `git diff --check` passed.

The pre-fix regression proved both missing paths: a fitness description selected
the general kit and `agent-sweep` did not load the database `best_for` column.

## First live wave (`CUDESC-20260725A`)

Twenty-two exact Gmail messages were swept against `yafet2132@gmail.com`.

- 20/22 passed.
- Fitness, wellness, workout, eyelashes, mascara, lashes, general fallback,
  ambiguity, explicit kit requests, FYI, injection, and scam boundaries passed.
- “Gym creator campaign” fell back to general because three-letter `gym` was
  filtered from description relevance.
- A legitimate skincare partnership was classified FYI by the model; the
  existing recovery intentionally excluded all FYI classifications.

Both failures became narrow regression fixes:

- normalize and retain meaningful three-letter description terms;
- recover a deterministic legitimate collaboration from an FYI model
  misclassification, while explicit “FYI only,” “no response,” and “do not
  reply” language remains excluded.

## Final live wave (`CUDESC-20260725B`)

The entire 22-case matrix was rerun with new Gmail message IDs.

- 22/22 passed.
- 4/4 fitness/gym/wellness/workout collaborations attached
  `logo-work-samples.png`.
- 4/4 eyelash/mascara/lashes/cosmetics collaborations attached the temporary
  eyelash PNG.
- 5/5 unmatched or explicit unknown requests attached
  `Yafet-Media-Kit.pdf`.
- The ambiguous generic beauty request attached the general PDF.
- 2/2 skincare/complexion requests attached the temporary skincare PNG.
- 2/2 explicit niche-kit requests selected the correct niche image.
- 2/2 FYI/no-response messages created no attachment.
- Prompt injection and credential-scam cases created no attachment.
- 0 automatic sends occurred.

Every success required both the expected `selected_media_kit_id` in Postgres and
the expected filename in the live Gmail draft.

## Restoration

- Auto-send was disabled before both waves and verified false afterward.
- Reply mode was restored to `draft_only`.
- The original user profile was restored.
- The existing fitness description was restored after the temporary synonym
  test.
- Temporary eyelash and skincare fixtures were archived; zero remained active.
- The retained general PDF, Northstar PNG, and fitness PNG were not deleted.
