# Normal inbox stage harness — 2026-08-09

## Outcome

Extension 0.5.4 adds an explicit **Add 10 normal test emails** control. It uses
the authenticated creator session to place ten clearly marked first-contact
messages in the connected Gmail inbox. Eight actionable items receive editable,
self-addressed Gmail drafts; two FYI items receive no draft. Nothing is sent.

The negotiation classifier now requires both commercial terms and an earlier
creator-sent message in the Gmail thread. A first brand email remains a normal
inbox item. A draft alone does not advance the stage; the creator must actually
send a reply before a later inbound commercial response can become a negotiation.

## Safety and recovery

- The Gmail `messages.insert` operation changes only the authenticated mailbox;
  it does not deliver mail externally.
- Every reply draft is addressed to the connected account itself.
- The batch action contains no `messages/send` or `drafts/send` request.
- Fixtures use deterministic RFC Message-IDs, so retries recover existing inbox
  messages and drafts instead of multiplying them.
- All rows are `is_test=true`, `auto_sent=false`, and `negotiation_id=null`.
- Dedicated fixture tests prove all ten first-contact messages contain no
  commercial-term trigger and the reply is under 150 words with no unsafe term.

## Verification

- `node --check extension/popup.js` — pass.
- `node --test extension/tests/*.test.js supabase/tests/*.test.mjs` — 103 pass,
  0 fail.
- `npx.cmd --yes deno test supabase/tests/*.ts` — 144 pass, 0 fail.
- Deno checks for both Edge Functions — pass.
- Live deployment: `agent-sweep` ACTIVE version 37 and `agent-api` ACTIVE
  version 25.
- Unauthenticated live `normal_test_emails_create` request — HTTP 401.

## Manual acceptance remaining

Reload extension 0.5.4 and click **Add 10 normal test emails**. Confirm ten Test
cards appear mixed into Today, eight expose **Review & send**, two are FYI, all
ten also appear in Gmail, and no negotiation card or sent reply is created.
