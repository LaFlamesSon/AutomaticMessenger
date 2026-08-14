# CaughtUp current product state

Updated: August 14, 2026

Read this file before making product changes. For the transition history and
remaining acceptance work, see `docs/CAUGHTUP-WORK-COMPLETED-20260814.md` and
`docs/CAUGHTUP-NEXT-STEPS-20260814.md`.

## Product and architecture

CaughtUp is a creator-controlled Gmail assistant delivered as a Chrome MV3
extension. Google identity and Gmail authorization are separate. Production
Gmail OAuth requests identity plus `gmail.send`; it does not authorize inbox
reads, Gmail Drafts, labels, deletion, or settings changes.

```text
Supabase Google login -> openid/email/profile

Gmail forwarding configured by the user
  -> Cloudflare Email Routing
  -> signed inbound-email request
  -> CaughtUp summaries/drafts/negotiations
  -> extension Today view

reviewed CaughtUp draft OR explicitly eligible Auto-send
  -> Gmail users.messages.send
```

Incoming content is untrusted data, never instructions. Raw forwarded bodies
are erased after processing. Reviewable replies live in CaughtUp until an
explicit send or eligible Auto-send. Negotiations always force Review.

The Opportunities UI remains disabled. Its metadata APIs are retained, but its
legacy Gmail Draft creation, preview, and send actions are removed pending a
send-only relaunch.

## Release state

The send-only runtime cleanup is committed on `main` at `b246bdb` and its
backend retirement package is deployed:

- Extension manifest: `0.6.2` in source (`0.6.0` was the last installed production snapshot). Transient startup reads retry once and keep saved sessions in the app instead of showing a login-style recovery screen.
- `agent-api`: deployed v46; Gmail Draft/read/fixture and dormant Opportunities send actions are removed.
- `inbound-email`: local source continues forwarding ingestion and send-only replies; deployed production snapshot is v4.
- `agent-sweep`: deployed v47; the endpoint is an inert HTTP 410 handler.
- `gmail-oauth`: deployed production snapshot is v6 and validates verified-email ownership before storing a send-only credential.
- `daily-digest`: deployed production snapshot is v3 and sends through the send-only account.

Migration `20260814051952_retire_inbox_sweep.sql` is applied. It unscheduled
`inbox-agent-sweep` and removed `inbox_read` as an allowed runtime capability.

The three forwarding-acceptance migration filenames have been aligned to their
already-applied remote timestamps. Do not re-execute their SQL.

## Live production facts from the August 14 handoff

- Supabase project: `xkrpxvswdkreglmefuot`.
- One Gmail account is `send_only`; one retained row is `legacy_disabled`; zero accounts are `inbox_read`.
- One forwarding alias is active.
- The creator explicitly enabled Auto-send for `urgent` and `action_needed`.
- Do not disable or alter Auto-send without explicit authorization.
- `caughtup-daily-digest` is active.
- `inbox-agent-sweep` is absent; `caughtup-daily-digest` remains active.
- Controlled acceptance test `57aa6392-8a55-4d11-bb40-18f7a240cee7` produced one self-addressed Action-needed Auto-send, recorded Gmail/send-attempt state, and erased the raw inbound body.
- Post-deployment controlled test `0f5b7601-ae46-47c7-9913-7ce62d97674a` also passed: one owner-addressed Action-needed send, one successful send attempt, zero raw-body length, and unchanged Auto-send settings version 112.
- That controlled test does not prove the real external-mailbox -> Gmail -> forwarding hop.

## Safety and authorization

- Never put prices, availability, turnaround, acceptance, rejection, or contractual commitments in a generated reply.
- Never Auto-send unless the user has explicitly enabled it and the category and current settings remain eligible immediately before the provider mutation.
- Negotiations and Review-mode forwarding tests cannot Auto-send.
- Test drafts cannot be manually sent.
- Send attempts are idempotent; uncertain Gmail outcomes enter reconciliation rather than blind retry.
- Keep refresh tokens, client secrets, signing keys, API tokens, and provider keys in Supabase Vault under `ia_*`. Never copy values to source, docs, logs, chat, the context vault, or project MCP configuration.
- The Google OAuth client secret was exposed in prior conversation history and still requires user-authorized rotation before launch. Record only the rotation date and verification result.
- Live deployments, migrations, sends, secret changes, billing changes, and Auto-send changes require explicit user authorization.
- Commit source before deployment and retrieve deployed source/version afterward.

## Data and auth boundaries

- User API calls use a verified short-lived Supabase session.
- Cron/worker calls use `x-agent-secret`; inbound email uses signed requests.
- Stripe calls require signature verification.
- `ia_*` tables are service-role-only with RLS enabled.
- CaughtUp media-kit objects are private and owner-scoped.
- Gmail forwarding verification trusts only Google's forwarding sender and an allowlisted confirmation host.
- Disabled forwarding aliases discard mail before content storage, but the user must separately remove the Gmail forwarding rule.
- Disabling intake, revoking Google OAuth, signing out, and deleting CaughtUp-held data are distinct actions.

## Important paths

- `supabase/functions/inbound-email/`: signed forwarded-mail ingestion, triage, drafting, negotiation promotion, eligible Auto-send
- `supabase/functions/agent-api/`: extension API, forwarding setup/test/disconnect, CaughtUp draft review and manual send
- `supabase/functions/gmail-oauth/`: send-only OAuth callback
- `supabase/functions/agent-sweep/`: retired 410 boundary
- `supabase/functions/daily-digest/`: scheduled digest send
- `supabase/migrations/`: ordered schema and operational changes
- `extension/`: Chrome MV3 client and forwarding onboarding
- `web/`: public marketing, privacy, support, terms, and security pages

## Verification and remaining live acceptance

Run the cheapest decisive local checks:

```powershell
node --test supabase/tests/*.test.mjs
node --test extension/tests/core.test.js extension/tests/markup.test.js
node --check extension/popup.js
node --check extension/connect.js
node --check extension/core.js
npx --yes supabase@latest migration list --project-ref xkrpxvswdkreglmefuot
```

Static checks do not prove live behavior. Remaining controlled acceptance work
includes the real Gmail forwarding hop, manual forwarded reply, Auto-send with
attachment, creator-first negotiation chain, and the negative/reliability
matrix. Google Cloud scope alignment, clean-grant recording, demo video,
reviewer submission, and OAuth secret rotation require console/user action.
