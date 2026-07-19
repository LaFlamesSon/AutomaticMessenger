# AutomaticMessenger

A local inbox agent for Gmail. It watches your inbox for emails matching
keywords you choose (like **"paid"** or **"advertisement"**), and automatically
sends a reply from a template you control — so sponsorship and advertising
emails never get lost in the scroll.

- **Runs locally** on your machine — your mail never goes through anyone's server.
- **Template replies with smart fill-ins** — `{{first_name}}`, `{{company}}`,
  `{{topic}}` are filled in from the email automatically. Free heuristics by
  default; optionally a free local AI model (Ollama) for smarter extraction.
- **Two modes** — run continuously in the background, or sweep on demand.
- **Safe by design** — dry-run mode, a per-sweep reply cap, never replies twice
  to the same thread (a Gmail label tracks what's handled), and never replies
  to `no-reply@` addresses.

## Setup

### 1. Install

```bash
git clone https://github.com/LaFlamesSon/AutomaticMessenger.git
cd AutomaticMessenger
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Get Gmail API credentials (one-time, ~5 minutes)

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → create a
   project (any name).
2. **APIs & Services → Library** → search **Gmail API** → Enable.
3. **APIs & Services → OAuth consent screen** → External → fill in the app name
   and your email → add yourself as a **test user**.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID** →
   Application type **Desktop app**.
5. Download the JSON and save it as `credentials.json` in this folder.

The first time you run the agent, a browser window opens for you to log in to
your Google account and approve access. After that, a `token.json` is saved
locally and it won't ask again.

### 3. Configure your keywords and replies

```bash
cp config.example.yaml config.yaml
```

Edit `config.yaml` — the example ships with two rules ready to customise:

```yaml
rules:
  - name: sponsorships
    keywords: ["paid", "sponsorship", "collab"]
    template: |
      Hi {{first_name}},

      Thanks for reaching out about {{topic}}! I'm interested in hearing
      more about working with {{company}}. Could you share the details?
```

Placeholders: `{{sender_name}}`, `{{first_name}}`, `{{company}}`, `{{topic}}`,
`{{subject}}`.

## Usage

**Always start with a dry run** — it shows exactly what would be sent, without
sending anything:

```bash
python -m automessenger sweep --dry-run
```

One-time sweep (scan + reply now):

```bash
python -m automessenger sweep
```

Continuous agent (checks every 5 minutes; Ctrl-C to stop):

```bash
python -m automessenger run              # default: every 300s
python -m automessenger run --interval 120
```

Every handled email gets the Gmail label `AutoMessenger/Processed`, so you can
see at a glance in Gmail what the agent answered — and it will never reply to
the same thread twice.

## Optional: smarter fill-ins with a free local AI

The built-in heuristics fill placeholders from the email headers and subject.
For smarter extraction (e.g. pulling the company name out of the email body),
install [Ollama](https://ollama.com), pull a small model, and flip one flag:

```bash
ollama pull llama3.2
```

```yaml
# config.yaml
ai_fill_ins: true
```

This runs entirely on your machine — no API key, no subscription, no per-email
cost. (If you ever want to use OpenAI's paid API instead, set `llm_base_url:
https://api.openai.com/v1` and export `OPENAI_API_KEY`.)

## Safety notes

- `config.yaml`, `credentials.json`, and `token.json` are gitignored — they
  contain personal data and must never be committed.
- `max_replies_per_run` (default 10) caps how many replies one sweep can send.
- If a reply ever looks wrong in dry-run, adjust the rule's `keywords` (matching
  is whole-word and case-insensitive, so `paid` will not match `unpaid`).
