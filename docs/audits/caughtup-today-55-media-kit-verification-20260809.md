# Today 55-card and media-kit verification — 2026-08-09

## Conditions

- Draft-ready test cards have a selected owned media kit and the actual Gmail
  draft contains that attachment.
- The skincare examples use the skincare kit.
- Direct Send controls use iOS blue; Test badges match the compact control type.
- Today exposes between 50 and 60 varied, clearly marked test cards.
- No test email is sent and Auto-send is not changed.

## Implementation

- Extension version 0.5.6 adds a dedicated `direct-send` style using `#007aff`
  and normalizes the Test badge to the same 11px/24px compact sizing.
- Migration `20260809230135_today_visual_harness_55.sql` adds 38 idempotent,
  database-only inbox fixtures under `qa-inbox:visual-v2:*`. They create no Gmail
  messages or drafts and do not touch tokens, negotiations, or Auto-send.
- The nine existing pending Gmail test drafts were updated through the normal
  version-checked `draft_get` / `draft_update` API flow. Their bodies and
  recipients were retained while one category-matched owned media kit was added.

## Evidence

- Full Node suite: 103 passed, 0 failed.
- Full Deno suite: 142 passed, 0 failed.
- `node --check extension/popup.js`: passed.
- `deno check supabase/functions/agent-api/index.ts`: passed.
- Migration history confirms local and remote version `20260809230135`.
- Live authenticated digest: 52 visible test email cards plus 3 visible test
  negotiation cards, total 55.
- Live draft verification: 9 Draft ready test cards, 9 with a media-kit label,
  and each of the nine Gmail drafts reported exactly one attachment.
- Both the ordinary skincare draft and skincare negotiation draft reported
  `QA-Skincare-Creator-Kit.png`.
- No send endpoint was called.

## User-visible acceptance

Reload extension version 0.5.6 and open Today. The 55 test cards should be mixed
by event time. Open Review on any Draft ready test card to see its selected kit
and attachment; direct Send buttons should appear blue.
