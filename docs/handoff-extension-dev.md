## From: backend-dev
## To: extension-dev
## Status: Calendar API contract locked for implementation
## Needs: Wire the fifth tab to these exact actions and preserve server error codes
## Read first: docs/audits/calendar-voice-media-loop.md

### API contract

- `calendar_get {}` returns:
  `{calendar:{contact_mode,phone_number,booking_url,timezone,weekly_availability,settings_version},bookings:[{id,title,start_at,end_at,status}]}`.
  `contact_mode` is `email_only`, `scheduled_call`, or `phone`; booking status is
  `held` or `booked`. Availability entries are `{day:0..6,start:"HH:MM",end:"HH:MM"}`.
- `calendar_set {fields,expected_settings_version}` returns
  `{ok:true,calendar,reply_mode:"draft_only",auto_send_disabled:true}`.
  Fields are `contact_mode`, `phone_number`, `booking_url`, `timezone`, and
  `weekly_availability`. A stale version returns HTTP 409/code `version_conflict`.
- `booking_create {title,start_at,end_at,request_id,kind?}` returns
  `{ok:true,booking,already_exists?,reply_mode:"draft_only",auto_send_disabled:true}`.
  `booking_delete {id}` returns
  `{ok:true,reply_mode:"draft_only",auto_send_disabled:true}`. `kind` is `hold` or `booking` and defaults to
  `hold`. Timestamps must be ISO-8601 with `Z` or an explicit offset. The interval
  must be inside configured weekly availability. Conflicts return HTTP 409/code
  `booking_conflict`; out-of-window requests return HTTP 422/code
  `outside_availability`. Reusing one owned `request_id` with the exact same payload
  is idempotent; a changed payload returns HTTP 409/code `idempotency_mismatch`.
  Exact retries do not mutate policy and therefore return the current `reply_mode`
  and `auto_send_disabled` values; newly created/deleted bookings force Review.
- Missing or foreign booking IDs return 404.

### Validation and display

- Phone numbers use E.164 (`+` plus 8-15 digits). Booking URLs are HTTPS origins
  with no embedded credentials. V1 accepts at most seven availability entries and
  exactly one editable window per day. `phone` mode requires a phone number; `scheduled_call` requires
  a booking URL or at least one availability window.
- Render returned values as text. Do not infer that a held/booked internal interval
  is synchronized to Google Calendar. Do not say a meeting is confirmed merely
  because the reply proposes a verified open slot.
