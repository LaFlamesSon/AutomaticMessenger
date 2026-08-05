# CaughtUp affiliate API release — 2026-08-04

## Release gate

| Condition | Status | Evidence |
|---|---|---|
| Source committed before deployment | Pass | Commit `348b37c` contains the ten affiliate API, migration, test, and extension files. |
| Backend type safety | Pass | `deno check supabase/functions/agent-api/index.ts`. |
| Policy and matching behavior | Pass | 38/38 Deno tests passed. |
| Extension and API contracts | Pass | 81/81 Node tests passed. |
| Named production migration | Pass | Remote migration history contains `20260805025333`. |
| Production schema exists | Pass | The six expected affiliate columns were returned from `information_schema.columns`. |
| New-table isolation | Pass | Both new tables report RLS enabled; `anon_select=false`, `authenticated_select=false`, and `service_role_select=true`. |
| Edge Function deployed | Pass | `agent-api` is active as version 16 with `verify_jwt=false`; authentication remains enforced inside the function. |
| Missing credentials rejected | Pass | Live `affiliate_sources_get` request without credentials returned HTTP 401 `unauthorized`. |
| Authenticated extension acceptance | Open | Requires the owner to reload extension source 0.4.1 and exercise the Opportunities forms with their existing session. |
| Provider catalog synchronization | Open | No provider credentials or approved partner application are configured. Manual affiliate product ingestion is active. |

## Safety notes

- No email was sent.
- No Gmail token, API token, Vault secret, Auto-send setting, billing state, or provider credential changed.
- Affiliate metrics and connections are owner-scoped through the authenticated Edge Function and are not shared across users.
- Affiliate opportunities never enter the inbox Auto-send path.
