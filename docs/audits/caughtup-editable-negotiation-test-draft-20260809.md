# Editable negotiation test-draft rollout — 2026-08-09

## Outcome

Extension 0.5.3 adds **Create editable test draft** to synthetic negotiation
cards. The authenticated action creates one Gmail draft addressed to the same
connected Gmail account, attaches the negotiation's pinned owned media kit, and
then exposes the existing **Review, edit & send** dialog. The draft is not sent.

## Safety and recovery

- The API accepts only an owned `ia_negotiations` row with `is_test=true`.
- The recipient is loaded from that negotiation's owned Gmail account; the
  caller cannot supply or change it during creation.
- Draft text remains bounded to 150 words and passes the existing pricing,
  commitment, availability, acceptance, and rejection safety filter.
- The stored processed-email row is marked `is_test=true`, `auto_sent=false`,
  `human_review_required=true`, and `delivery_status='draft'`.
- The action contains no Gmail send endpoint. Sending remains a separate,
  explicit creator click through the existing version-checked review flow.
- A deterministic RFC Message-ID lets a retry recover the same Gmail draft if
  Gmail succeeded before database state reconciliation.

## Verification

- `node --check extension/popup.js` — pass.
- `node --test extension/tests/*.test.js supabase/tests/*.test.mjs` — 101 pass,
  0 fail.
- `npx.cmd --yes deno test supabase/tests/*.ts` — 142 pass, 0 fail.
- `npx.cmd --yes deno check supabase/functions/agent-api/index.ts` — pass.
- Supabase function listing after deployment — `agent-api` ACTIVE version 24;
  `agent-sweep` remains ACTIVE version 36.
- Unauthenticated live `negotiation_test_draft_create` request — HTTP 401.

## Manual acceptance remaining

Reload extension 0.5.3, click **Create editable test draft** on one Test
negotiation, then click **Review, edit & send**. Confirm the textarea is editable,
the pinned kit is selected, swapping or removing the kit saves to the same Gmail
draft, and no message is sent unless **Send reply** is clicked.
