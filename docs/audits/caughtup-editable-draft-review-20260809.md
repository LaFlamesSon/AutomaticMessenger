# Editable Gmail draft review — 2026-08-09

## Root cause

The existing extension retained its live Gmail preview and explicit send path,
but the preview was read-only. Repository history contains no committed
`draft_update` action or popup media-kit swap control; users had to edit the
draft in Gmail and reopen the preview. Synthetic harness records also have no
Gmail draft ID by design, so they correctly expose proposed text without a send
button.

## Implemented behavior

Extension 0.5.2 adds an editable reply textarea and an owned media-kit selector
to the existing review dialog. Changes are saved to the same Gmail draft before
the separate Send reply action becomes available.

Real negotiation cards expose **Review, edit & send** when a live processed-email
draft is linked to the negotiation. The flow updates the negotiation's proposed
reply and pinned kit after Gmail confirms the draft update. Test negotiations
remain preview-only and cannot send.

## Safety and ownership

- The API loads processed emails only through the authenticated user's owned
  Gmail account IDs.
- Draft updates require the current 64-character preview fingerprint, preventing
  stale overwrites.
- Edited replies remain limited to 150 words and are rejected when they include
  pricing, acceptance, rejection, availability, or commitment language.
- A replacement kit must be active and owned by the authenticated user.
- CaughtUp replaces at most one attachment. If the live draft contains an
  unfamiliar or user-added attachment, editing fails closed and directs the user
  to Gmail rather than deleting it.
- Unsaved popup changes disable Send reply.
- Sending still uses the existing idempotent, preview-version-checked manual
  send action. No negotiation can auto-send.

## Verification

- Source commit: `54e24c9` (`Add editable Gmail draft review flow`)
- Extension source: 0.5.2
- `agent-sweep`: active version 36
- `agent-api`: active version 23
- Node suite: 100 passed, 0 failed
- Deno suite: 196 passed, 0 failed
- JavaScript syntax and Edge Function type checks passed
- Unauthenticated live `draft_update` request returned HTTP 401

No real Gmail draft was modified and no message was sent during deployment
verification. Final acceptance of Gmail's live update response remains a
user-triggered test through an existing real Review draft.
