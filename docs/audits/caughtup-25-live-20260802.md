# CaughtUp 25-case live acceptance — 2026-08-02

## Gate and controls

- Production project `xkrpxvswdkreglmefuot`; baseline `agent-sweep` v30.
- Twenty-five exact Gmail message IDs, swept sequentially.
- Every fixture was self-addressed to `yafet2132@gmail.com`; live profile and
  media-kit settings were read but never changed.
- Evidence came from `ia_processed_emails` plus each actual Gmail Draft or Sent
  artifact, including recipient and attachment filename.

## Final result

**25/25 product conditions passed after one fix and fresh verification.**

- Delivery: 3 Auto-sent, 20 Review drafts, 2 no-reply outcomes.
- All 3 automatic replies were addressed only to `yafet2132@gmail.com`.
- Missing-detail replies: logo, packaging, and owner-read inquiries auto-sent;
  lower-confidence or attachment-bearing inquiries correctly stayed in Review.
- Kit routes passed for Fitness, Eyelash, Skincare, Automotive, Finance, Home
  Interior, Food, Technology, Travel, configured LumaLash brand, and General
  fallback cases. All Review artifacts contained their expected PDF or image.
- Pet care, education, and social-design requests used General.
- Prompt injection produced no reply; FYI produced no reply.
- Budget and forced-acceptance inputs produced safe Review drafts with no price,
  acceptance, delivery, availability, or booking claims.
- Owner-read mail was processed. A second targeted sweep of the same Gmail ID
  scanned zero messages.

## Baseline findings and disposition

The initial assertion report was 21/25. Three flags were incorrect expectations:

1. A website page list included the word `portfolio`, which is an explicit sample
   request and correctly selected the General attachment in Review.
2. A supposedly complete inquiry omitted its budget range; the model stayed below
   the 0.90 unattended-send threshold and correctly left a safe draft.
3. Travel was expected to fall back to General, but the tenant now has an active
   Travel Lifestyle kit, which was the correct configured match.

The remaining failure was real: an explicitly broad, multi-category beauty request
selected Eyelash because its description uniquely contained `beauty`. Commit
`d6c66e0` adds an explicit-ambiguity fallback while preserving exact sender-domain
and brand overrides. All 101 local policy/backend/extension checks passed.
`agent-sweep` v31 was then deployed, and a fresh exact Gmail fixture selected
`Yafet General Media Kit` with `Yafet-Media-Kit.pdf`.
