# CaughtUp Calendar, Voice, and Media-Kit Closed Loop

Date: 2026-07-21
Owner: EA
Status: Authorized by Yafet on 2026-07-21

## Why now

The Gmail delivery loop is live, but the next product claim needs proof across the
actual user experience: drafts should adapt to a person's writing, choose the
right media kit, and honor how that person wants brands to contact or schedule
them. The current prompt always suggests a call and the extension has no calendar
or contact-preference surface.

## Scope

### Prompt and voice experiments

- Run controlled, self-addressed Gmail fixtures with different inquiry wording.
- Compare generated drafts under the existing voice profile.
- Edit and send one controlled draft, allow `ia_draft_edits` to capture the exact
  before/after pair, then prove a later draft adopts measurable style traits.
- Keep all fixtures isolated with targeted manual sweeps; do not touch the 201
  unrelated unread messages.

### Media-kit proof

- Verify the extension upload prepare/upload/complete path with a bounded safe PDF
  or image fixture.
- Label at least two kits with distinct brand/domain/keyword metadata.
- Send controlled portfolio requests and prove the uniquely matching kit is
  selected, attached to the Gmail draft, and surfaced by label in the extension
  API. Prove ambiguous ties fall back without guessing.
- Remove test-only kits after evidence is captured unless the owner asks to keep
  them.

### Calendar and contact preferences

- Add a fifth `Calendar` extension tab.
- Store per-user contact mode: `email_only`, `scheduled_call`, or `phone`.
- Store an optional phone number and optional booking URL with strict validation.
- Store weekly availability in the user's configured IANA timezone.
- Store internal busy/held slots and reject overlaps transactionally so two
  CaughtUp bookings cannot occupy the same time.
- Make the draft prompt conditional:
  - `email_only`: never suggest a call or phone contact.
  - `phone`: offer the configured phone/contact method without exposing it when
    absent.
  - `scheduled_call`: propose only server-verified open slots or the configured
    booking URL.
- Treat email content as untrusted and never let a sender rewrite preferences,
  phone numbers, availability, or bookings.

## Important policy boundary

The repository currently forbids drafts from stating availability. This phase
requests a narrow explicit override: CaughtUp may **propose** user-configured,
server-verified open call slots or a user-configured booking link. It still may
not accept an offer, claim a meeting is booked, promise turnaround, or expose an
unconfigured contact method. Actual booking confirmation remains outside the
reply until a booking is recorded.

The first version prevents conflicts inside CaughtUp's own availability/bookings.
It cannot guarantee protection against events created in Google Calendar or other
calendar products until an external calendar integration is authorized and built.

## Expected files

- `supabase/migrations/20260721*_calendar_contact_preferences.sql`
- `supabase/functions/agent-api/index.ts`
- `supabase/functions/agent-sweep/index.ts`
- `supabase/functions/_shared/policy.ts`
- `supabase/tests/policy.test.ts`
- `supabase/tests/source-contract.test.mjs`
- `extension/popup.html`
- `extension/popup.js`
- `extension/popup.css`
- `extension/core.js`
- `extension/tests/*.test.js`
- `CLAUDE.md` and deployment/audit evidence after verification

## Acceptance conditions

1. Five accessible tabs render with Calendar linked to one matching panel.
2. Contact preference round-trips through owner-scoped APIs.
3. Email-only drafts contain no call, scheduling, booking, or phone suggestion.
4. Phone-mode drafts use only the configured validated number/contact method.
5. Scheduled-call drafts use only verified availability or a configured booking
   URL and never claim a meeting is confirmed.
6. Two overlapping internal bookings cannot both be created.
7. Media uploads reject unsafe or oversized content and complete only after server
   validation.
8. Unique media-kit metadata selects and attaches the expected kit; ambiguity does
   not guess.
9. A captured before/after draft edit changes measurable traits in a later draft
   while all hard safety rules remain intact.
10. Auto-send remains off during prompt, voice, media-kit, and calendar testing.
11. Existing regression tests and Deno checks pass; deployed versions are verified.
12. Unrelated unread Gmail messages and unrelated dirty worktree files remain
    untouched.

## Risks and controls

- Real email mutation: use exact Gmail account/message IDs and self-addressed or
  reserved test recipients only.
- PII exposure: never print phone numbers, email bodies, tokens, or attachment
  contents in logs or durable memory.
- Double booking: use a database exclusion/transactional conflict check, not a
  client-side-only check.
- Prompt hallucination: provide structured server-owned contact context and retain
  post-generation safety validation.
- Calendar scope ambiguity: do not claim external-calendar conflict prevention in
  this phase.
- Deployment loss: commit source before migration/function deployment.

## Authorization requested

Authorize the schema migration, extension/backend implementation, controlled Gmail
draft/send experiments, temporary test media-kit uploads, and the narrow policy
change allowing drafts to propose verified user-entered availability. Auto-send
will remain off throughout this phase.
