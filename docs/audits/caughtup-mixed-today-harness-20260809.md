# Mixed Today timeline and no-send harness — 2026-08-09

## Outcome

Extension 0.5.1 presents actionable inbox messages and creator negotiations in
one chronological Today feed. Negotiations no longer occupy a fixed top panel.

- Below-minimum negotiations are red.
- Within-range, incomplete, or unconfigured negotiations are yellow.
- At-or-above-target negotiations are green.
- Each negotiation expands to show context, previous terms, and a proposed
  reply when one is safely available.
- Dismiss removes the alert from Today after confirmation. A later inbound
  message clears dismissal and resurfaces the negotiation.
- Owner scoping is enforced by both negotiation ID and authenticated user ID.

## Live fixtures

The account `yafet2132@gmail.com` has a six-card interleaved demonstration:
three existing `qa-negotiation:*` negotiations and three new `qa-inbox:*`
processed-email records. Two synthetic inbox cards and all three negotiation
cards include proposed replies.

These are display metadata only. The migration explicitly keeps
`draft_created=false`, `auto_sent=false`, `delivery_status='none'`, and
`gmail_draft_id=null`. It does not insert send attempts or call Gmail. Auto-send,
OAuth credentials, Gmail messages, labels, drafts, and existing media-kit files
were not changed.

## Deployment evidence

- Source commit: `93520cb` (`Mix negotiations into Today timeline`)
- Migration: `20260809214727_negotiation_timeline_controls.sql`, present in the
  linked local and remote ledgers
- `agent-sweep`: active version 35
- `agent-api`: active version 22
- Extension source: 0.5.1
- Live unauthenticated `agent-api` request: HTTP 401

## Verification

- JavaScript syntax check passed.
- Edge Function Deno type checks passed.
- Node extension/source/security suite: 97 passed, 0 failed.
- Deno behavior/source suite with repository read permission: 193 passed,
  0 failed.
- Migration dry-run selected only the intended migration; the live push then
  completed successfully.

The final user-visible acceptance step is reloading the unpacked extension and
checking the authenticated Today feed in Chrome. Chrome's session credential
was deliberately not extracted for command-line testing.
