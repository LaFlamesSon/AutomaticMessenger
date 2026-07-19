# CaughtUp — UI Spec (v1, "super simple")

Design system (shared everywhere): ink `#17181c`, cream `#f7f5f0`, accent orange
`#e07a3f`, green `#2c7a4b` for success. System font. Envelope+spark mark.
One rule: **every screen answers "what did my agent do, and what needs me?"**

## Chrome extension (built — `extension/`)

380px popup, 3 tabs. Zero-config after pasting the access token once
(Phase 2 replaces token paste with Google sign-in).

- **Today** — the digest. Urgent cards first (sender, subject, one-line
  summary, `draft ready` / `reply sent` badge). FYI below. Low-priority and
  spam collapse to a single count line ("🗑 23 handled"). Empty state:
  "🎉 All caught up." Header has one **Sweep now** button.
- **Chat** — talk to your agent. Anything phrased as a standing instruction
  ("be more casual", "never suggest calls on Fridays") is saved as a
  permanent rule — confirmed inline with a green chip. Context history
  persists server-side (`ia_chat_messages`), so the agent remembers.
- **Settings** — name, occupation, services, tone, sign-off, standing rules,
  and the **auto-send toggle** (off by default; label explains the tradeoff).

## Website (mockup built — `web/index.html`)

Apollo-style structure but stripped to one page:
hero (claim + one CTA) → 3-step how-it-works → live-look digest card →
single $12 pricing card → footer. Dark ink hero, cream body, orange CTAs.
Phase 2 adds: Stripe checkout behind the CTA, a signed-in dashboard
(same Today digest + billing), and the OAuth connect flow as onboarding.

## Deliberate omissions (keep it simple)

- No inbox-replica UI — Gmail already exists; we only show the digest.
- No threads/labels management, no folders, no analytics dashboards in v1.
- One accent color, one font, no dark-mode toggle in v1.
