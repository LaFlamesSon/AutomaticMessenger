# Deploying the Inbox Agent to Supabase (Phase 0)

Target project: the fresh Supabase project (`xkrpxvswdkreglmefuot`).

## 0. One-time prerequisites (the "gaps" only you can fill)

| Secret | Where to get it |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud Console → OAuth client, type **Web application**. Add the gmail-oauth function URL (step 2) as an **Authorized redirect URI**. Enable the Gmail API and add yourself as a test user. |
| `GEMINI_API_KEY` | aistudio.google.com/apikey — free, no card required. The free tier (1,500 requests/day) covers personal-inbox volume many times over. |

**Optional — use a different LLM provider** (any OpenAI-compatible API). Set these three secrets instead of `GEMINI_API_KEY`:

| Provider | `LLM_BASE_URL` | `LLM_MODEL` | `LLM_API_KEY` |
|---|---|---|---|
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` | platform.deepseek.com key |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | platform.openai.com key |
| Groq (free tier) | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | console.groq.com key |
| `AGENT_CRON_SECRET` | Any long random string (e.g. `openssl rand -hex 32`). Shared between the cron job and the function. |

## 1. Apply the schema

Easiest: connect the project to the Claude Supabase integration (claude.ai →
Settings → Connectors → Supabase → grant the new project) and Claude applies
`migrations/20260719000001_inbox_agent_init.sql` for you. Or use the CLI:

```bash
supabase link --project-ref xkrpxvswdkreglmefuot
supabase db push
```

## 2. Deploy the functions

```bash
supabase functions deploy agent-sweep --no-verify-jwt
supabase functions deploy gmail-oauth --no-verify-jwt
```

(`--no-verify-jwt`: gmail-oauth must be browser-reachable; agent-sweep is
protected by the `x-agent-secret` header instead.)

## 3. Set the function secrets

```bash
supabase secrets set \
  GOOGLE_CLIENT_ID=... \
  GOOGLE_CLIENT_SECRET=... \
  GEMINI_API_KEY=... \
  AGENT_CRON_SECRET=...
```

(`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.)

## 4. Connect your Gmail

Open in a browser:

```
https://xkrpxvswdkreglmefuot.supabase.co/functions/v1/gmail-oauth
```

Log in with the Gmail account, approve, see "connected".

## 5. Test one sweep manually

```bash
curl -s -X POST \
  -H "x-agent-secret: $AGENT_CRON_SECRET" \
  https://xkrpxvswdkreglmefuot.supabase.co/functions/v1/agent-sweep | jq
```

You should see a digest grouped by category (urgent first) and, for
urgent/action-needed emails, drafts waiting in your Gmail drafts folder — plus
the `AI-Processed` label on everything triaged.

## 6. Schedule it (every 10 minutes)

Run in the SQL editor — replace `YOUR_SECRET`:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'inbox-agent-sweep',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://xkrpxvswdkreglmefuot.supabase.co/functions/v1/agent-sweep',
    headers := jsonb_build_object('x-agent-secret', 'YOUR_SECRET')
  );
  $$
);
```

## 7. Customize your voice (optional but recommended)

```sql
update ia_voice_profiles set
  display_name = 'Yafet',
  occupation = 'a freelance brand designer',
  services = 'logo design, brand identity, packaging',
  custom_rules = ''  -- e.g. 'Never suggest calls on Fridays'
where user_id = (select id from ia_users limit 1);
```

Style memory: whenever you edit a draft before sending, save the before/after
into `ia_draft_edits` — the agent includes your last 10 edits as "this is how I
actually write" examples. (Automating this capture is a Phase 1 extension task.)

## Phase 0 gate

You stop reading your inbox manually because the drafts + digest are enough.
When that's true, move to Phase 1 (Chrome extension) per PLAN.md.
