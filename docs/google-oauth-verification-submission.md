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

Inbound brand email arrives through CaughtUp's separate forwarding and
processing pipeline. Until forwarding is configured and activated, CaughtUp
shows setup guidance and has no inbox content to process. Reviewable replies
are stored in CaughtUp, not Gmail Drafts, and no legacy Gmail token is used.

## Demo video checklist

Record a real end-to-end walkthrough in English using a dedicated test account:

1. Start signed out and open the production extension setup flow.
2. Show Google identity consent and the resulting CaughtUp session.
3. Show the separate Gmail consent screen listing only permission to send email.
4. Return to CaughtUp, complete the forwarding-address confirmation and activation flow, and run the controlled test.
5. Demonstrate a real external message arriving through Gmail forwarding and an explicitly approved reply from the verified Gmail address.
6. Show Auto-send disclosure, a negotiation remaining Review-only, forwarding disconnect instructions, Google revocation instructions, and the deletion-request path.
7. Show that CaughtUp does not request inbox reading, draft, label, or settings
   permissions.

Do not resubmit the previous restricted-scope verification materials. First
align the Google Cloud Data Access page with the scopes above, revoke the test
account's prior CaughtUp grant, and record the new consent flow from a clean
grant so old permissions cannot appear in the video.
