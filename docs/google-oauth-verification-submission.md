# CaughtUp Google OAuth Verification Submission Pack

Updated: August 14, 2026

## Production scope selection

Keep only these scopes in the production Google Cloud project and consent flow:

- `openid`
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/userinfo.profile`
- `https://www.googleapis.com/auth/gmail.send`

Remove every Gmail read, compose, draft, label, settings, metadata, and broad
mailbox scope from the Cloud Console. The OAuth consent screen, deployed code,
and verification submission must show the same four scopes.

## User-facing functionality

CaughtUp uses Google identity to create and match the user's CaughtUp account.
It uses Gmail send access only to deliver a reply from that same verified Gmail
address after the user approves sending, or when that user has separately and
explicitly enabled an eligible auto-send policy. CaughtUp does not use Google
OAuth to read the inbox, create Gmail drafts, change labels, delete messages, or
change Gmail settings.

Inbound brand email will arrive through CaughtUp's separate forwarding and
processing pipeline. Until that pipeline is configured for a user, inbox sweep
and Gmail-draft actions return `inbound_forwarding_required` and do not use any
legacy Gmail token.

## Demo video checklist

Record a real end-to-end walkthrough in English using a dedicated test account:

1. Start signed out and open the production extension setup flow.
2. Show Google identity consent and the resulting CaughtUp session.
3. Show the separate Gmail consent screen listing only permission to send email.
4. Return to CaughtUp and show Gmail sending as connected.
5. Demonstrate an explicitly approved send from the verified Gmail address once
   the forwarding-based reply workflow is production-ready.
6. Show that CaughtUp does not request inbox reading, draft, label, or settings
   permissions.

Do not resubmit the previous restricted-scope verification materials. First
align the Google Cloud Data Access page with the scopes above, revoke the test
account's prior CaughtUp grant, and record the new consent flow from a clean
grant so old permissions cannot appear in the video.
