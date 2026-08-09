# Card send and communication-memory cleanup — 2026-08-09

## Outcome

- Removed the **Add 10 normal test emails** extension control and backend action.
- Ordinary inbox cards no longer expose proposed reply text inline. Review opens
  the editable draft dialog.
- Draft-backed ordinary and negotiation cards expose compact **Review** and
  **Send** controls. Negotiations retain **What this is about** and proposed-reply
  preview details.
- Card-level Send fetches the current Gmail draft, confirms the actual recipients,
  and submits its exact preview fingerprint with an idempotency key.
- The backend rechecks the live draft fingerprint, word limit, and reply-safety
  policy before claiming a send attempt. No live email was sent during verification.
- Ask CaughtUp continues storing both sides of chat in `ia_chat_messages` and now
  reports persisted communication-style memory after an optimistic,
  version-checked `ia_voice_profiles` update. Later chats and sweeps consume that
  saved profile. Review-dialog edits remain recorded in `ia_draft_edits`.

## Verification

- `node --check extension/popup.js`
- `node --test extension/tests/*.test.js supabase/tests/*.test.mjs`
  — 102 passed, 0 failed.
- `npx.cmd --yes deno test supabase/tests/*.ts`
  — 142 passed, 0 failed.
- `npx.cmd --yes deno check supabase/functions/agent-api/index.ts`
- Source committed before deployment as `e665bca`.
- `agent-api` deployed active at version 26.
- Unauthenticated production probe returned HTTP 401 `unauthorized`.

## Manual acceptance

Reload extension source version 0.5.5 from `extension/`. Verify an ordinary draft
card shows compact Review and Send controls without inline reply text, while a
negotiation card keeps its context and preview. Clicking Send should show the
recipient confirmation; canceling that confirmation sends nothing.
