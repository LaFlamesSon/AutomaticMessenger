# CaughtUp live fix regression — 2026-07-25

## Outcome

The production fix cycle closed the defects discovered by the prior 100-case
stress run. Deployed versions are `agent-api` v9 and `agent-sweep` v21.

The run used `yafet2132@gmail.com` as the target inbox and the existing
controlled QA sender. Every inbound message was located and swept by its exact
Gmail message ID. Scheduled sweep cron remained paused and Auto-send remained
off.

## Source and deployment

- `49c9df4` — safe Review recovery, deterministic portfolio intent, configured
  signoff enforcement, recent manual-edit learning priority, and stable
  content-based attachment preview hashes.
- `43b46f2` — recognize deadline replies whose work context is expressed as a
  project/creative/full brief or brand assets.
- `f8e02e7` — recognize natural portfolio requests using needs, wants,
  requests, or looking-for phrasing.
- `agent-api` v9 and `agent-sweep` v21 were listed ACTIVE after deployment.

## Local gates

- Policy tests: 22/22 passed.
- Backend source-contract tests: 27/27 passed.
- Extension core/markup tests: 34/34 passed.
- Both touched Edge Functions passed Deno type checking.
- JavaScript syntax and `git diff --check` passed.

## Live waves

### Targeted regression (`CUFIX-20260725A`)

Fifteen exact-message scenarios exercised sponsor recall, urgent mail containing
a budget, email-only meeting handling, general PDF selection, Northstar and
fitness PNG selection, brand mention without attachment, injection/scam/FYI
boundaries, configured signoff, repeated attachment previews, controlled manual
send, and voice learning.

- 14/15 matched the initial strict assertions.
- The only mismatch was a safe Review draft for “Hey, circling back. Thoughts?”
  The draft asked for the missing context. This was accepted as correct product
  behavior because the inbox owner had not replied and the draft made no
  commitment.
- Two no-edit attachment previews returned the same SHA-256 preview version.
- The controlled manual PDF send retained the PDF in the Gmail SENT MIME.
- A recent edited/manual extension send was learned despite the older backlog;
  reported style examples increased from 2 to 6.

### Broad boundary wave (`CUBROAD-20260725A`)

Thirty fresh variations covered eight sponsor requests, five urgent requests,
five explicit FYI messages, five scams, five prompt injections, and two
portfolio routes.

- 28/30 passed immediately.
- One urgent “full brief” request was categorized urgent but received no draft.
  This became the brief-context deterministic fallback fix.
- One Northstar case timed out at the harness/provider boundary before a result.
  It was rerun rather than counted as product success.
- 0 automatic sends and 0 unsafe created drafts were observed.

### First focused repeat (`CURETRY-20260725A`)

- All three brief/deadline variants passed after the brief-context fix.
- Two of three Northstar variants attached the expected PNG.
- “NorthstarQA needs relevant visual work examples” exposed a missing natural
  request verb and became the portfolio-language fix.

### Final focused confirmation (`CURETRY-20260725B`)

- 3/3 brief/deadline variants created safe urgent Review drafts.
- 3/3 Northstar natural-language variants created action-needed Review drafts
  with `logo-work-samples.png` attached.
- Final result: 6/6 passed.

## Safety and restoration

- Auto-send was disabled before every wave and verified false after restoration.
- The only live sends were two explicit manual-send tests to the controlled QA
  sender.
- No price, availability, turnaround, acceptance, rejection, or booking
  commitment appeared in a created test draft.
- The test temporarily applied creator-oriented profile text and the `Cheers`
  signoff, then restored the original profile after every wave.
- Active retained kits remain the general PDF, Northstar PNG, and fitness PNG.

## Remaining acceptance work

The decisive remaining user-visible check is a signed-in pass through all five
extension tabs in the user's normal Chrome profile. The live backend paths are
green, but static extension tests do not substitute for that popup interaction.
