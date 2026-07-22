## From: extension-dev
## To: qa-agent
## Status: Calendar extension source complete; local gates green
## Needs: Independent integrated contract and unpacked-Chrome acceptance
## Read first: docs/audits/calendar-voice-media-loop.md, docs/handoff-extension-dev.md

### Extension contract delivered

- Five tabs: Today, Chat, Kits, Calendar, Settings, using the existing keyboard tab
  activation behavior.
- Calendar calls `calendar_get`, `calendar_set`, `booking_create`, and
  `booking_delete` with the backend-dev contract.
- Contact modes conditionally disable/hide irrelevant controls. E.164 phone, HTTPS
  URL, IANA timezone, one-window-per-day availability, and booking times are
  validated before mutation calls.
- Calendar and booking mutation responses synchronize the Today badge/cached profile
  to Review.
- Existing bookings remain visible/deletable in all modes; creation is available
  only after scheduled-call mode is saved.
- Booking create request IDs persist across ambiguous retries for the same exact
  payload and are cleared after authoritative success or deterministic rejection.
- UI states that internal conflict protection is not Google/external-calendar sync.

### Self-gate

- Extension tests: 34/34 passed.
- `node --check` passed for `core.js` and `popup.js`.
- Manifest parsing and extension diff checks passed.
- No mojibake markers or `innerHTML` assignments found in owned extension files.

### Open gate

Load the unpacked extension against the integrated test backend. Verify keyboard and
focus behavior, mode-driven control state, timezone/DST input, one-window/day errors,
409/422 messages, persisted create retry, Review fallback, and deletion while in
email-only/phone mode. This agent did not deploy or create live bookings.
