# Single Google Flow and Model Recovery

Date: 2026-07-24
Status: Authorized by the user

## Scope

Restore inbox classification after DeepSeek retired the configured legacy model
name, and consolidate initial CaughtUp identity plus Gmail authorization into one
Google OAuth launch for new extension sessions.

## Files and live surfaces

- `extension/popup.js`
- `extension/tests/`
- `supabase/functions/agent-api/index.ts`
- `supabase/functions/agent-sweep/index.ts`
- `supabase/tests/`
- Supabase Vault key `ia_llm_model`
- Deployed `agent-api` and `agent-sweep`

No schema change is expected.

## Acceptance conditions

1. The configured DeepSeek model is supported and a JSON classification request
   returns successfully.
2. DeepSeek V4 classification explicitly uses non-thinking mode without adding
   provider-specific fields to other OpenAI-compatible providers.
3. A new session launches Google authorization once with identity and
   `gmail.modify` scopes plus offline consent.
4. The extension never persists the Google provider access or refresh token.
5. The authenticated backend validates the provider access token against Gmail,
   binds the Gmail address to the authenticated CaughtUp user, and stores only
   the refresh token server-side.
6. Missing provider tokens fail safely into the existing separate Gmail consent
   fallback instead of leaving onboarding broken.
7. Existing connected accounts continue to load without renewed consent.
8. A targeted brand-email sweep classifies the reserved message, creates a draft
   when policy allows, and selects a media kit only on a unique relevant match.
9. Auto-send remains off; no broad Inbox sweep is used for acceptance.
10. Local regression/type checks pass, code is committed before deployment, and
    deployed function versions are verified.

## Risks and controls

- Provider refresh tokens are highly sensitive. They may exist only in the
  transient OAuth callback and request body, must be sent over TLS to the
  authenticated backend, must never be logged, and must be discarded by the
  extension after the completion call.
- Google may omit a refresh token on previously granted consent. Force offline
  consent and preserve the current state-bound Gmail OAuth fallback.
- A Gmail address already owned by another CaughtUp user must return a conflict;
  it must never be reassigned silently.
- Live testing is limited to the exact reserved brand fixture. Auto-send remains
  disabled and the scheduled sweep remains paused.

## Why now

The active DeepSeek model name was retired on 2026-07-24, causing every new
sweep to fail before classification. The two-launch OAuth design also created
confusing partial identities during real multi-computer onboarding.

## Evidence

- Baseline: five consecutive runs on the newly connected Gmail account scanned
  one message and failed before classification; the message claim was left
  retryable with `message_failed`.
- Root cause: the configured `deepseek-chat` request returned HTTP 400 because
  the provider retired that model name. The same credential and endpoint
  returned HTTP 200 with `deepseek-v4-flash` and thinking disabled.
- OAuth boundary: Supabase redirected the combined request to Google with
  `openid`, `email`, `profile`, `gmail.modify`, offline access, and forced
  consent, then back through the Supabase callback.
- Local gate: 34/34 extension tests, 26/26 source-contract tests, and 18/18 Deno
  policy tests pass. Both changed Edge Functions pass `deno check`, and the
  extension script passes Node syntax checking.

Deployment, encrypted configuration update, exact-message Gmail verification,
and a user-visible fresh-session OAuth run remain to be recorded.
