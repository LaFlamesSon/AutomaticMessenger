# CaughtUp (AutomaticMessenger) — project state for Claude

Read this first in every new session. It is the single source of truth for
where the project stands; trust it over stale conversation history.

## What this is

**CaughtUp** — an AI inbox agent for Gmail, being built as a $12/mo product.
It sweeps the user's inbox on a schedule, triages every unread email
(urgent / action_needed / fyi / low_priority / spam_or_poor_fit), writes
reply drafts in the user's voice, labels processed mail "AI-Processed",
and surfaces everything in a Chrome extension (Today digest / Chat /
Settings). Owner: LaFlamesSon (yafet2105@gmail.com; connected Gmail is
yafet2132@gmail.com).

Product rules baked into the agent prompt: reference a specific detail from
the sender's email, ask for missing scope/budget/timeline/brand materials,
suggest a short call, <150 words, NEVER state prices/availability/turnaround,
NEVER accept or decline offers, spam gets noted not drafted.

## Architecture

- **Supabase project** `xkrpxvswdkreglmefuot` ("Automatic Messenger").
  Everything server-side is Edge Functions (Deno) + Postgres + Vault + Storage.
- **LLM**: DeepSeek (`deepseek-chat`) via OpenAI-compatible chat completions.
  Provider-agnostic: `ia_llm_base_url` / `ia_llm_model` / `ia_llm_api_key`.
- **Config**: ALL secrets live in Supabase Vault as `ia_*` entries, read via
  the `ia_get_config()` SECURITY DEFINER RPC (service_role only). Functions
  use `cfg(vaultName, envName, fallback)`. No dashboard env secrets needed.
  Vault keys: ia_google_client_id, ia_google_client_secret, ia_llm_api_key,
  ia_llm_base_url, ia_llm_model, ia_agent_cron_secret,
  ia_stripe_webhook_secret (not yet set — billing dormant until it is).
- **Auth**: extension → agent-api via per-user `ia_users.api_token`
  (x-api-token header). Cron → functions via x-agent-secret header.
- **Media kits**: Storage bucket `media-kit`, per-user folder
  `media-kit/{user_id}/`, attached to drafts when sender asks for portfolio.

## Deployed edge functions (all live)

| Function | Version | Purpose |
|---|---|---|
| agent-sweep | v8 | Core loop: triage, draft (or auto-send if profile.auto_send), label, style learning via `learnFromSentDrafts` |
| agent-api | v3 | Extension backend: digest, chat (rule-learning), profile_get/set, send_draft, sweep |
| gmail-oauth | v4 | OAuth connect; success page shows the user's api_token for onboarding |
| daily-digest | v1 | Daily summary email sent to self |
| stripe-webhook | v1 | checkout.session.completed → plan=pro; subscription.deleted → plan=free. Returns 503 until ia_stripe_webhook_secret exists |
| seed-media-kit | v2 | One-off seeding of demo media kit |

All deployed verify_jwt=false with their own auth (secret headers / Stripe
signature / OAuth flow).

## Cron (pg_cron + pg_net)

- `inbox-agent-sweep`: `0 */3 * * *` → POST agent-sweep
- `caughtup-daily-digest`: `0 15 * * *` (8am PT) → POST daily-digest
- Both send x-agent-secret from vault value ia_agent_cron_secret.

## Database (all tables RLS-enabled, no policies = service-role only)

ia_users (api_token, plan free/trial/pro, stripe_customer_id),
ia_gmail_accounts (refresh_token, user_id), ia_voice_profiles
(display_name, occupation, services, tone, signoff, custom_rules,
always_ask, auto_send), ia_processed_emails (category, summary,
draft_created, draft_text, gmail_draft_id, auto_sent, edit_captured),
ia_agent_runs, ia_draft_edits (style-learning pairs), ia_chat_messages.

## Repo layout

- `supabase/functions/*` — edge function sources (deployed copies match git)
- `supabase/DEPLOY.md` — ops runbook
- `extension/` — Chrome MV3 extension (load unpacked). Today digest with
  one-click Send ↗ per draft, Chat with typing animation, Settings incl.
  auto_send toggle. Token stored in chrome.storage.sync.
- `web/index.html` — landing page mockup (not hosted yet)
- `automessenger/` — legacy Python CLI from phase 1 (superseded)
- `UI-SPEC.md`, `PLAN.md` — design docs

## Git flow

Develop on `claude/new-session-98me19` (or the session's designated branch),
push, then ff-merge to `main` and push (user has authorized this flow).

## Environment gotchas (remote sandbox)

- Direct curl to supabase.co and raw Postgres :5432 are blocked. Use the
  Supabase MCP tools; trigger functions with `select net.http_post(...)`
  via execute_sql, results in `net._http_response`.
- Large `deploy_edge_function` MCP calls intermittently fail with
  "Tool permission stream closed" AbortError — just retry; commit to git
  first so nothing is lost.
- Use GitHub MCP tools, not `gh`.

## Backlog (agreed, not started)

1. Stripe activation: user creates Stripe account + $12/mo Checkout link
   (client_reference_id = ia_users.id), store signing secret in vault as
   ia_stripe_webhook_secret.
2. Proper Google sign-in inside the extension (replace paste-a-token).
3. Host the landing page (apollo.io-style marketing site).
4. Key rotation: DeepSeek key, Google client secret, and the Supabase DB
   password were pasted in chat and should be rotated.
5. Chrome Web Store packaging/publish.
