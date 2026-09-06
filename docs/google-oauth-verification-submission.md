# CaughtUp Google OAuth Verification Submission Pack

Updated: September 6, 2026

Use this as copy-paste text in Google Cloud Console. Request only the scopes
below. Do not add Gmail read, compose, draft, label, metadata, settings, or
`mail.google.com`.

## Production scope selection

Keep only these scopes on the OAuth consent screen and in Data Access:

- `openid`
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/userinfo.profile`
- `https://www.googleapis.com/auth/gmail.send`

Identity (`openid` / email / profile) is used only for CaughtUp sign-in through
Supabase. Gmail sending is a separate consent. The deployed Gmail connect flow
requests exactly:

```text
openid email profile https://www.googleapis.com/auth/gmail.send
```

`gmail.send` is a **sensitive** scope. It is not a restricted mailbox scope.
Do not request `gmail.readonly`, `gmail.modify`, `gmail.compose`,
`gmail.metadata`, `gmail.insert`, or `https://mail.google.com/`. Those would
trigger a restricted-scope review and a security assessment that this product
does not need.

Before you submit: align the Cloud Console Data Access page with the four
scopes above, revoke the test account's prior CaughtUp grant, and record the
demo from a clean grant so old permissions cannot appear in the video.

## App information

**App name:** CaughtUp

**User-facing description:**

```text
CaughtUp is a creator-controlled Gmail assistant. Creators sign in with Google
to create a CaughtUp account, then separately authorize CaughtUp to send email
from that same verified Gmail address. Brand mail reaches CaughtUp through
Gmail forwarding that the creator configures. Reviewable replies are stored in
CaughtUp. CaughtUp sends a reply only after the creator reviews and sends it,
or when that creator has explicitly enabled an eligible Auto-send policy.
CaughtUp does not read the Gmail inbox, create Gmail drafts, change labels,
delete messages, or change Gmail settings.
```

**Homepage:** `https://getcaughtup.io/`

**Privacy policy:** `https://getcaughtup.io/privacy/`

**Terms:** `https://getcaughtup.io/terms/`

**Support:** `https://getcaughtup.io/support/`

**Authorized domains:** `getcaughtup.io`

## Scope justification

`openid`, `userinfo.email`, and `userinfo.profile` are non-sensitive Google
Sign-In scopes. The console pre-fills them. They do not need a written
justification.

Write a justification only for the sensitive scope, `gmail.send`, and explain
why a narrower Gmail scope is not enough.

### `https://www.googleapis.com/auth/gmail.send`

```text
CaughtUp uses https://www.googleapis.com/auth/gmail.send only to send email
from the creator's own verified Gmail address through
gmail.googleapis.com/gmail/v1/users/me/messages.send. A send happens only
after the creator reviews and approves a reply in the CaughtUp extension, or
when that creator has separately and explicitly enabled an eligible Auto-send
policy for a category. CaughtUp also sends an optional daily digest to the
same creator when they have digest email enabled.

This is the narrowest Gmail scope that can send those messages. Gmail Add-on
scopes and gmail.compose are not sufficient: CaughtUp does not create Gmail
Drafts, does not run as a Gmail Add-on, and stores reviewable replies in
CaughtUp until send. Inbox reading scopes are not requested because inbound
brand email arrives through user-configured Gmail forwarding, not the Gmail
API. CaughtUp does not read the inbox, list messages, change labels, delete
mail, or change Gmail settings.
```

## How Google user data is used, stored, and deleted

```text
Identity: CaughtUp stores the verified Google email and a short-lived
CaughtUp session so the creator can use the extension. Sign-in uses OpenID
email and profile only.

Gmail send: After consent, CaughtUp stores a send-only OAuth refresh token
server-side, scoped to gmail.send, and uses it only to send a reviewed reply,
an eligible Auto-send reply, or the creator's daily digest. The token is not
used to read mailbox contents.

Inbound mail is not obtained through Gmail OAuth. The creator configures
Gmail forwarding to a CaughtUp address. CaughtUp stores a normalized copy of
forwarded messages for drafting and review until the creator deletes
CaughtUp-held data.

Creators can disconnect Gmail sending, disable forwarding, sign out, or
request deletion from the extension and support pages. They can also revoke
CaughtUp in their Google Account permissions. CaughtUp does not sell Google
user data or use it for advertising.
```

## Demo video checklist

Record a real end-to-end walkthrough in English on an unlisted YouTube video,
using a dedicated test account after revoking any prior CaughtUp grant:

1. Start signed out. Open the production Chrome extension setup flow.
2. Show Google identity consent (`openid` / email / profile) and the resulting
   CaughtUp session.
3. Show the separate Gmail consent screen. The address bar must show the
   production OAuth client ID. The screen must list permission to send email
   only, not inbox, draft, label, or settings access.
4. Return to CaughtUp. Complete forwarding-address confirmation and
   activation, then run the controlled test send.
5. Show a real external message arriving through Gmail forwarding and an
   explicitly approved reply sent from the verified Gmail address.
6. Show Auto-send disclosure, a negotiation remaining Review-only, forwarding
   disconnect, Google revocation instructions, and the deletion-request path.
7. Show that CaughtUp does not request inbox reading, Gmail Draft, label, or
   settings permissions.

## Console checklist before Submit for verification

1. OAuth consent screen is External, production app name is CaughtUp.
2. Data Access lists only the four scopes above.
3. Gmail API is enabled. No leftover restricted Gmail scopes remain.
4. Authorized JavaScript origins and redirect URIs match the production
   extension and `.../functions/v1/gmail-oauth` callback.
5. Homepage, privacy policy, and terms are live on `getcaughtup.io`.
6. Test user grant was revoked, then re-granted, so the video shows a clean
   `gmail.send` consent.
7. Do not resubmit older materials that mentioned inbox read, Gmail Drafts,
   or `gmail.modify`.
