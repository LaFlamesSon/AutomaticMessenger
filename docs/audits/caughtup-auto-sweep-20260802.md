# Sweep now / Auto-send closed loop — 2026-08-02

## Reported behavior

With Auto-send enabled, pressing `Sweep now` appeared to leave replies as Draft
ready instead of sending them and did not clearly report what happened.

## Root causes

1. The earlier self-addressed QA fixtures caused the next broad sweep to see the
   automatic responses as fresh Inbox mail. The worker did not exclude a candidate
   that itself carried Gmail's `SENT` label, so it drafted replies to owner mail.
2. Deterministic recovery and model confidence below 0.90 always forced Review,
   even when a bounded information request could safely replace uncertain wording.
3. Media kits marked Auto-attach were still restricted to exact sender-domain
   matches, so clear brand, keyword, and description matches remained drafts.
4. The extension refreshed Today but cleared its status without saying how many
   replies were actually sent or held for review.

## Fix

- Owner-originated Inbox candidates are labeled handled and skipped without a
  processed-email row or reply.
- Legitimate low-confidence/unsafe-model recovery uses the deterministic bounded
  information request with safety and contact postprocessing still enforced.
- A uniquely selected kit is Auto-send eligible only when its owner-controlled
  Auto-attach setting is enabled. Ambiguous matches still use the default or stop.
- The General kit's Auto-attach setting was explicitly enabled through agent-api.
- Extension 0.3.8 displays `Sweep complete: N replies sent; M replies need review.`

No-reply categories, hostile inbound instructions, draft-safety violations,
contact-policy violations, standing Review rules, missing kit opt-in, ambiguous kit
ties, and a changed settings version still prevent unattended sending.

## Verification

- Local: 103/103 policy, backend-contract, and extension checks passed.
- Deployed: `agent-sweep` v32 and `agent-api` v14.
- Gmail acceptance used the official `users.messages.import` endpoint with
  `gmail.modify` to create exact inbound fixtures. Automatic recipients were
  restricted to `yafet2132+qa@googlemail.com`, the same Gmail inbox.

| Case | Result |
|---|---|
| Safe inquiry missing details | Auto-sent; 1 sent, 0 Review |
| Pet-care/general fallback | Auto-sent with `Yafet-Media-Kit.pdf` |
| Fitness request | Auto-sent with `QA-Fitness-Creator-Kit.png` |
| Prompt injection | `spam_or_poor_fit`; no reply |
| Owner-originated self message | Skipped; no processed row or reply |

Final live result: **5/5 passed**.
