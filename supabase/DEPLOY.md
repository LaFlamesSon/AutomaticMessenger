# CaughtUp Supabase deployment

The existing Supabase project is CaughtUp's active development backend. Iterate
in place while the product is pre-release: keep Auto-send disabled, make additive
schema changes through named migrations, deploy contract-coupled functions as one
set, and verify the unpacked extension after every rollout. Never copy secrets,
tokens, or email content into source, logs, chat, or the context vault.

## Required configuration

Store runtime secrets in Supabase Vault using `ia_*` names. Required values include
the Google OAuth client ID/secret, LLM endpoint/model/key, `ia_agent_cron_secret`,
and `ia_allowed_extension_ids`. The last value is one exact Chrome extension ID or
a comma-separated set of explicitly approved IDs. The API fails closed if it is
absent. Add the exact callback returned by `chrome.identity.getRedirectURL()` to
the Supabase Auth redirect allowlist. Google OAuth must authorize the deployed
`gmail-oauth` function URL.

## Safe deployment sequence

1. Back up the target database and capture currently deployed function versions.
2. Run the local gates:
   `node --test supabase/tests/policy.test.ts supabase/tests/source-contract.test.mjs`,
   Deno type-check all Edge Functions, and `git diff --check -- supabase`.
3. Pause the existing sweep and digest jobs, back up the current project, then
   apply all named migrations to the existing development project. Verify every `ia_*` table
   has RLS enabled and no grants or policies for `anon`/`authenticated`.
4. Deploy `agent-api`, `agent-sweep`, `daily-digest`, and `gmail-oauth` together.
   Mixed old/new versions are not contract-compatible. Deploy only committed source
   and verify the deployed version before continuing.
5. Exercise authenticated extension onboarding. Gmail consent starts only through
   the authenticated `gmail_connect_start` action; do not browse directly to the
   callback. Confirm `profile_get` reports the owned `gmail_address` separately
   from the application-auth email.
6. With Auto-send disabled, run the two-user isolation suite with controlled test
   identities in the current project. Manual sweeps must go through authenticated `agent-api:sweep`, which
   supplies the verified user ID. Do not call the all-account worker with a cron
   secret and do not perform real sends without a separately approved allowlisted
   test plan.
7. Only after all coupled functions are deployed and verified, explicitly install
   dispatcher jobs with the correct environment origin:

   ```sql
   select public.ia_install_dispatch_cron('https://YOURPROJECTREF.supabase.co');
   ```

   The helper accepts only a Supabase project origin, or HTTP for approved local
   development hosts. It removes legacy `caughtup-daily-digest`,
   `inbox-agent-daily-digest`, and `inbox-agent-sweep` jobs, then installs five-minute
   dispatchers whose `x-agent-secret` is resolved from Vault at runtime. Merely
   applying migrations never changes active cron jobs.
8. Re-run deployed verification and the unpacked-extension checks. Keep real sends
   and Auto-send disabled until their controlled acceptance cases are deliberately
   exercised.

## Rollback

Disable dispatch jobs first, restore the captured function versions as one set,
and use a reviewed named rollback migration where schema rollback is safe. Never
perform ad-hoc production DDL or overwrite refresh/API tokens during rollback.
