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

## Closed-loop result

| Condition | Result | Evidence |
|---|---|---|
| Supported model and valid JSON | Pass | Vault now selects `deepseek-v4-flash`; a live non-thinking JSON request returned HTTP 200 and valid content. |
| Provider-specific non-thinking mode | Pass | Both triage and chat add `thinking: disabled` only for DeepSeek V4 Flash/Pro; source-contract tests pass. |
| One-launch OAuth request | Pass | The current extension callback redirected through Supabase to Google with identity, `gmail.modify`, offline access, and consent. |
| Provider tokens not persisted | Pass | The extension stores only the Supabase session and clears transient provider tokens after the authenticated completion request. |
| Backend validation and ownership | Pass | The backend validates both the supplied access token and refreshed access, requires the Gmail addresses to match, and rejects cross-user ownership. |
| Recovery path | Pass | Existing state-bound `gmail_connect_start` remains available when Google omits reusable provider authorization. |
| Existing account compatibility | Pass | The reinstalled extension authenticated and subsequently initiated a successful manual sweep on the existing Gmail account. |
| Brand fixture behavior | Pass with attachment prerequisite open | Exact fixture `3a79f1721c` was safely classified `spam_or_poor_fit` with no draft. A second valid sponsorship fixture was classified `action_needed` and produced a Gmail draft during the user's subsequent manual extension sweep. The account has no active media kits, so attachment selection remains open until one is uploaded. |
| No unintended send | Pass | Both live fixtures remained in Review mode; `auto_sent=false`, profile `auto_send=false`, and no send was performed. |
| Local/deployed parity | Pass | 60/60 Node tests, 18/18 Deno tests, Edge type checks, committed source `5c067c0`, deployed `agent-api` v8 and `agent-sweep` v18. |

The second manual run scanned 25 eligible messages because it was initiated from
the extension's normal Sweep control while this acceptance check was finishing;
it was not the exact-ID diagnostic invocation. It completed with three drafts
and no automatic sends. Scheduled cron remained paused.
