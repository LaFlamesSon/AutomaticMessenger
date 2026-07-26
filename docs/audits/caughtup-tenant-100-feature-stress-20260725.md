# CaughtUp 100-scenario tenant and feature stress — 2026-07-25

## Scope and safety

The run used the controlled tenant `yafet2132@gmail.com` and controlled sender
`carolynpaezz.mgmt@gmail.com`. Auto-send remained disabled. Four sends were
explicit manual-extension sends to the controlled sender: three voice-learning
edits and one attachment-preview/idempotency check.

Fixtures exercised the retained general PDF and fitness PNG plus temporary
eyelash, skincare, and technology PNG kits. Temporary kits and settings were
removed or restored at closeout.

## 100-scenario matrix

The first pass produced 92/100:

| Area | First pass |
|---|---:|
| Media-kit routing | 23/25 |
| Baseline writing style | 10/10 |
| Settings: concise style | 10/10 |
| Chat: warm style | 10/10 |
| Settings: formal style | 10/10 |
| Edit-based style learning | 5/5 |
| Email-only contact | 6/6 |
| Phone contact | 6/6 |
| Scheduled-call contact | 0/6 |
| Robustness and safety | 12/12 |

The eight first-pass failures were rerun with fresh Gmail message IDs after
fixes. Both media-kit cases and all six scheduled-call cases passed 8/8.

Additional fresh boundaries passed email-only contact 1/1. A new hostile
inbound case established a failing baseline: “ignore account settings” could
receive a safe Review draft despite the model summarizing it as suspicious.
After a deterministic server-side hostile-inbound gate, a fresh confirmation
was categorized `spam_or_poor_fit` with no draft, kit, or attachment (1/1).

No message was auto-sent.

## Media-kit behavior

- Fitness, eyelash, skincare, and technology language selected their specific
  image kit.
- Unmatched travel, restaurant, furniture, home-goods, and ambiguous beauty
  collaborations used the general PDF fallback.
- FYI, scam, prompt-injection, and owner-handled cases did not attach kits.
- Manual preview hashes remained stable, idempotent manual send returned the
  same sent message, and the general PDF remained attached after sending.

## Style behavior

- Settings-enforced concise replies used “Thanks for reaching out” in 10/10
  cases and the configured `Regards` signoff.
- A Chat instruction for warm, upbeat, conversational replies persisted to the
  profile and produced “Appreciate you reaching out” in 10/10 cases.
- Formal Settings changes produced the configured `Sincerely` signoff in
  10/10 cases.
- Three controlled owner edits increased learned examples from 6 to 9.
  Two subsequent probes showed the edited short/conversational pattern,
  including one “Hey” opener.
- All measured drafts remained under the 150-word safety limit and contained
  no price, acceptance, turnaround, invented availability, or auto-send action.

## Extension UI/backend contracts

The local policy, backend source-contract, and extension markup/core suites
passed 90/90. The live API matrix behind the five popup tabs passed 26/26:

| Surface | Live checks |
|---|---:|
| Settings | 6/6 |
| Authentication | 3/3 |
| Today | 4/4 |
| Chat | 3/3 |
| Kits | 4/4 |
| Calendar | 6/6 |

The matrix covered owned profile/Gmail status, token rejection, digest rows and
kit labels, authoritative stable previews, Chat persistence and unsafe-style
rejection, kit CRUD/validation boundaries, optimistic Settings conflicts,
safe Review enforcement, sender-rule CRUD, Calendar validation, idempotent
booking creation, overlap rejection, and deletion.

This is live backend/API evidence plus static extension wiring evidence. A final
signed-in, user-visible five-tab click pass in Chrome remains a manual
acceptance check; this run did not claim browser-rendered end-to-end success.

## Fixes deployed

- `agent-api` v10: validated Chat writing-style suggestions persist to the
  voice profile and return the update to the extension.
- `agent-sweep` v25: description matching scores compound terms such as
  `skin`/`skincare`, and legitimate “looking for” collaboration language is
  recognized.
- `agent-sweep` v26: dotted booking URLs survive contact postprocessing and
  its idempotency safety recheck.
- `agent-sweep` v27: hostile inbound instructions, including attempts to
  override account settings, deterministically become spam with no draft.

## Closeout

- Auto-send: `false`
- Reply mode: `draft_only`
- Calendar mode restored: `email_only`
- Original tone and `Best` signoff restored
- Temporary kits active: `0`
- Retained kits: general PDF, fitness PNG, Northstar PNG

