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

## Demo video

Google reviews this video to confirm you understand `gmail.send`. Last
submissions failed when the recording looked like inbox access, Gmail Drafts,
or a generic login. This video has to prove three facts:

1. Consent asks only for permission to send email.
2. Inbox content arrives through Gmail forwarding, not the Gmail API.
3. `gmail.send` is used when the creator clicks Send, because a real message
   then appears in that Gmail account's Sent folder.

Record on the already-deployed send-only product. Do not add new scopes for
the video. If the Cloud project has leftover unused OAuth clients, delete
them before recording. The form requires every assigned client to appear in
the video.

### Before you press record

1. In Cloud Console, Data Access lists only the four scopes above.
2. On the Clients page, keep only the clients this app actually uses
   (typically the Chrome / web client for Google sign-in and the send-only
   Gmail client). Open each remaining client and note its client ID.
3. Publishing can stay Production. Do not ship a new unverified scope to
   other users. Record with one dedicated test Gmail account.
4. On that test account, open Google Account, Third-party access, and
   remove CaughtUp so the unverified-app screen appears. That screen is
   expected and must be in the video.
5. Sign out of the extension. Use a clean Chrome window. Keep the address
   bar visible for every Google page.
6. Have a second mailbox ready to send one short brand-style test into the
   test Gmail, then forward it to the CaughtUp alias.

### Shot list (English narration, about 6 to 8 minutes)

Linger 3 to 4 seconds on each Google screen. Say what the screen is and why
it exists.

0. Project clients (10 seconds). Open Cloud Console, Clients. Point at each
   remaining client ID. Say: "These are the only OAuth clients in this
   project. The video will show each of them."

1. Start signed out (15 seconds). Open the production CaughtUp extension.
   Show the connect / sign-in screen. Say: "This is the production CaughtUp
   Chrome extension."

2. Google identity consent. Complete sign-in with openid / email / profile
   only. Show the unverified-app screen if it appears, the App Name
   CaughtUp, and the address bar client ID. After sign-in, show the
   extension session. Say: "This first consent is Google sign-in only. It
   does not grant Gmail send or inbox access."

3. Separate Gmail send consent. This is the required scope. When the
   extension asks to connect Gmail, show the unverified-app screen and
   click through it; the address bar, including the OAuth client ID; the
   App Name CaughtUp; and the permission list: Send email on your behalf.
   No read, draft, label, or settings permission. Say: "This second consent
   is https://www.googleapis.com/auth/gmail.send. CaughtUp uses it only to
   send from this same verified Gmail address. It cannot read the inbox."
   If sign-in and send use two different client IDs, both must appear in
   the address bar across shots 2 and 3.

4. Forwarding, not Gmail read (45 to 90 seconds). Show CaughtUp's forwarding
   address, Gmail's forwarding confirmation, and activation. Say: "Brand
   email reaches CaughtUp because I configured Gmail forwarding. That is
   why we do not request gmail.readonly or gmail.modify."

5. A real inbound message (30 seconds). From the second mailbox, send a
   short test to the test Gmail, let it forward, and show it in CaughtUp
   Today as a reviewable draft. Open Gmail Drafts and show it is empty.
   Say: "The reply lives in CaughtUp, not Gmail Drafts. That is why
   gmail.compose is not enough and gmail.send is the scope we need."

6. The send. This is the proof. In CaughtUp, open the draft, click the
   explicit Send control, then open Gmail, Sent and show the same reply
   from the connected address. Say: "CaughtUp just called Gmail
   users.messages.send with the send-only token. That is the only Gmail
   API use of this scope." Do not make Auto-send the proof. Reviewers
   need to see a person approve a send.

7. Limits (30 seconds). Show Auto-send as an explicit opt-in that stays
   off unless the creator enables it, and say negotiations stay
   Review-only. Do not enable Auto-send during the video unless you
   already planned a separate controlled test.

8. Disconnect and delete (30 seconds). Show CaughtUp disconnect /
   revocation guidance and Google Account, Third-party access. Optionally
   show Settings export or deletion. Say: "The creator can revoke send
   access in Google Account without giving CaughtUp inbox access."

### Do not put in the video

- Vault, refresh tokens, client secrets, or SQL
- Another person's real brand mail
- Inbox read, Gmail Draft creation, labels, or settings changes
- Old gmail.modify language
- A recording that starts already connected with no consent screens

Upload to YouTube as Unlisted. Paste that URL into the YouTube link field.
The Save button enables after the link is valid.

### Spoken recording script

Print this or keep it on a second screen. Do the action in brackets, pause,
then say the line. Speak slowly. Linger 3 to 4 seconds on every Google
screen. Keep the browser address bar visible.

**Off camera, once:** Revoke CaughtUp on the test Google account. Sign out
of the extension. Open Cloud Console on the test project. Have a second
mailbox ready. Do not show secrets.

---

**Scene 0. Clients, about 15 seconds**

[Open Google Cloud Console → Clients.]

"This Google Cloud project is CaughtUp. These are the only OAuth clients
assigned to it. The rest of this video will use each of them."

[Point at each client ID.]

---

**Scene 1. Extension, about 15 seconds**

[Open the production CaughtUp Chrome extension. You are signed out.]

"This is the production CaughtUp Chrome extension. CaughtUp is a
creator-controlled Gmail assistant. I am starting signed out so you can
see both Google consents from a clean grant."

---

**Scene 2. Sign-in only, about 45 seconds**

[Click Connect or the Google sign-in control. When Google opens, do not
rush.]

"This first Google screen is sign-in only: openid, email, and profile.
CaughtUp uses it to create the account and match the verified email. It
does not grant Gmail send, and it does not read the inbox."

[If the unverified-app screen appears, stay on it.]

"This unverified-app screen is expected while we wait for Google's review.
I am showing it on purpose."

[Show the address bar, including the client ID. Show the app name
CaughtUp. Finish sign-in. Return to the extension.]

"I am now signed into CaughtUp. Gmail sending is still not authorized."

---

**Scene 3. gmail.send consent, about 60 seconds**

[Click Connect Gmail.]

"This second consent is the sensitive scope we are requesting:
https://www.googleapis.com/auth/gmail.send."

[Show the unverified-app screen again if it appears. Show the address
bar and the client ID. If this client ID is different from sign-in, say
so.]

"The address bar shows this project's OAuth client ID. The app name is
CaughtUp."

[On the permission list, point at Send email on your behalf.]

"Google is asking only for permission to send email on my behalf. There
is no permission to read the inbox, create Gmail drafts, change labels,
delete mail, or change Gmail settings. That is the narrowest scope that
can send from my own Gmail address."

[Allow / Continue. Return to the extension.]

"CaughtUp now has a send-only token for this same verified Gmail
address. It still cannot read my mailbox through the Gmail API."

---

**Scene 4. Forwarding, about 90 seconds**

[In CaughtUp, open Set up forwarding. Show the alias address.]

"Brand email reaches CaughtUp through Gmail forwarding that I configure,
not through Gmail read scopes. This is the CaughtUp forwarding address."

[Open Gmail settings → Forwarding. Add the address. When Google's
confirmation appears in CaughtUp, click Confirm with Google, then in
Gmail turn on Forward a copy and Save. Click I enabled forwarding if
shown.]

"I added that address in Gmail and confirmed Google's forwarding email.
Inbox content now arrives because I forwarded it. That is why we do not
request gmail.readonly or gmail.modify."

---

**Scene 5. A real message, about 45 seconds**

[From the second mailbox, send a short test to the test Gmail, such as
"Test partnership for the September brief." Wait until it appears in
CaughtUp Today as Draft ready.]

"A real message was sent to this Gmail account, forwarded to CaughtUp,
and a reply draft appeared in the extension."

[Open Gmail → Drafts. Show it is empty.]

"Gmail Drafts is empty. The reply lives in CaughtUp until I approve it.
gmail.compose is not enough, because we never create a Gmail draft."

---

**Scene 6. The send. This is the proof, about 60 seconds**

[In CaughtUp, open the draft. Click Send. Confirm Send this reply
through Gmail.]

"I am explicitly sending this reply. CaughtUp will call Gmail
users.messages.send with the send-only token. That is the only Gmail API
use of this scope."

[Wait for Reply sent. Open Gmail → Sent. Show the same message from the
connected address.]

"Here is the same reply in Gmail Sent, from my connected address. That
is why we need gmail.send."

---

**Scene 7. Limits, about 20 seconds**

[Open Settings. Show Review before sending selected. Do not turn on
Auto-send.]

"Auto-send is off unless the creator later enables it. Negotiations stay
in Review. The proof you just saw was a person clicking Send."

---

**Scene 8. Revoke, about 20 seconds**

[Show CaughtUp disconnect or Settings guidance, then Google Account →
Third-party access.]

"The creator can disconnect CaughtUp here, and can revoke send access in
their Google Account. Revoking send access does not require inbox
access."

[Stop recording.]

---

Upload as Unlisted on YouTube and paste the link into the form.

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
