# CaughtUp (AutomaticMessenger) — current project state

Read this first in a new session. It records the deployed architecture and the
safety posture; prefer it over stale conversation history.

## Product

CaughtUp is a Gmail inbox agent delivered as a Chrome MV3 extension. It can
triage recent unprocessed Inbox mail, prepare reviewable replies in the user's learned voice,
send only through an explicit preview/send flow, attach a matching media kit,
and apply the user's email, phone, or scheduled-call contact preference.

The extension is version **0.3.1** with five tabs: Today, Chat, Kits, Calendar,
and Settings. Calendar currently manages CaughtUp availability and internal
bookings; it does not claim or provide Google Calendar synchronization.

## Safety posture

- Email content is untrusted data, never agent instructions.
- Auto-send is off and the production profile is in Review (`draft_only`).
- Contact details and scheduling slots come from owner-controlled server state.
- A draft may offer server-verified open slots, but never claim a meeting is
  confirmed, booked, or reserved.
- Calendar/contact changes force Review mode and increment settings version.
- Broad legacy Inbox mail is not a test fixture. Live QA uses exact Gmail IDs.
- Normal sweeps include unread and owner-read Inbox messages from the last
  seven days, but skip a candidate when its thread has a later owner SENT
  message or draft.

## Architecture

- Supabase project: `xkrpxvswdkreglmefuot`.
- Server: Deno Edge Functions + Postgres + Storage + Vault.
- LLM: OpenAI-compatible provider configured by Vault keys
  `ia_llm_base_url`, `ia_llm_model`, and `ia_llm_api_key`.
- Extension auth: a new session requests Supabase Google identity and
  `gmail.modify` in one Google launch. Transient provider tokens are validated
  and matched server-side, never persisted by the extension, and the prior
  separate Gmail consent remains only as a recovery path. A verified Supabase
  JWT authenticates `agent-api`; the legacy per-user API token remains for
  controlled diagnostics.
- Gmail worker auth: `x-agent-secret`; secrets are read through
  `ia_get_config()` from Supabase Vault.
- Media kits: private Storage objects plus owner-scoped metadata. Matching uses
  configured brands/domains/keywords and refuses ambiguous ties.

## Deployed Edge Functions

| Function | Version | Purpose |
|---|---:|---|
| `agent-sweep` | 18 | Exact/batch Gmail triage, DeepSeek V4 non-thinking JSON requests, owner-handled thread exclusion, safe drafting, contact policy, kit selection, voice learning |
| `agent-api` | 8 | Extension API, combined Google provider-token handoff, preview/send, media-kit lifecycle, calendar preferences/bookings |
| `gmail-oauth` | 5 | Gmail OAuth connection |
| `daily-digest` | 2 | Daily digest delivery |
| `seed-media-kit` | 3 | Controlled media-kit seed utility |
| `stripe-webhook` | 1 | Billing webhook; billing remains dormant until configured |

All functions perform their own request authentication; `verify_jwt=false` at
the platform edge is intentional, not an authorization bypass.

## Database

Core tables include `ia_users`, `ia_gmail_accounts`, `ia_voice_profiles`,
`ia_processed_emails`, `ia_agent_runs`, `ia_draft_edits`, and
`ia_chat_messages`. Media-kit metadata is owner-scoped and Storage objects are
private. Calendar migration `20260721000004_calendar_contact_preferences.sql`
adds `ia_calendar_preferences` and `ia_bookings`.

Calendar rows are service-role only under RLS. Security-definer RPCs use an
empty `search_path`. A GiST exclusion constraint is the authoritative atomic
double-booking guard; API idempotency and owner checks sit above it.

## Operations and live verification

- Scheduled sweep cron is paused during iterative live QA.
- Auto-send remains off after every test.
- Runtime model `deepseek-v4-flash` returned valid JSON after the retired
  `deepseek-chat` name caused HTTP 400 failures.
- The current unpacked-extension callback is allowed by both Supabase Auth and
  the encrypted backend allowlist. A real manual extension sweep completed
  after reinstall: a valid sponsorship fixture became `action_needed` and
  produced a safe Gmail draft; a vague fixture became `spam_or_poor_fit`
  without a draft.
- Concurrent overlapping booking attempts produced one success and one 409;
  idempotent retry and cross-owner deletion checks passed.
- Live reply experiments passed email-only, phone, and scheduled-call rules.
- Media-kit upload validation, correct unique selection/attachment, ambiguous
  no-selection, and cleanup passed.
- An 18-case live exact-message stress matrix passed 15 cases. PDF domain,
  PNG brand, JPEG keyword, ambiguous tie, default fallback, owner-read mail,
  owner-handled threads, injection resistance, long natural briefs, and
  email-only postprocessing all worked without any automatic send. Direct
  meeting requests without an explicit email fallback produced no draft in two
  runs, and one of ten drafts omitted the exact configured signoff.
- Two exact sent-edit examples produced measurable subsequent voice changes
  without price, availability, commitment, or contact-policy violations.

## Repository layout

- `supabase/functions/` — Edge Function sources; deploy only committed code.
- `supabase/migrations/` — database changes; never make ad-hoc schema edits.
- `extension/` — unpacked Chrome/Edge MV3 source.
- `docs/audits/` — closed-loop conditions and QA evidence.
- `context-vault/ops/sessions/` — EA-invoked agent handoffs.
- `web/` and `automessenger/` — marketing prototype and superseded legacy CLI.

## Next product work

1. Make legitimate call/meeting requests deterministically produce an
   information-gathering email reply when the saved contact mode is
   `email_only`; add the C12/C16/C18 cases as regressions.
2. Enforce the configured signoff server-side instead of relying only on the
   model prompt.
3. Perform one signed-in Calendar save/create/delete pass in the user's normal
   Chrome profile.
4. Add real Google Calendar integration only with explicit OAuth scope and
   truthful external conflict checks.
5. Configure/activate Stripe, host the marketing site, and prepare Web Store
   packaging when product behavior is accepted.
6. Rotate any credentials previously exposed in chat or local logs.
