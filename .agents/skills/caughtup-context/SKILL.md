---
name: caughtup-context
description: Run the EA-controlled CaughtUp agent-memory lifecycle and maintain the Obsidian LLM Wiki. Use on /startup, when the Executive Assistant explicitly starts, resumes, or invokes a named CaughtUp agent, when that invoked agent closes its task, or when the user explicitly asks to ingest, query, reorganize, or lint the vault. Do not invoke for ordinary Hi or root turns merely because the repository is open.
---

# CaughtUp Context

Use `C:\Users\yafet\OneDrive\Desktop\CaughtUp` as the canonical durable memory
vault. The repository path `context-vault/` is a junction to that location, so
relative paths remain portable inside project workflows. Keep `CLAUDE.md` as the
concise deployed-state snapshot and the vault as the linked history behind it.

## Lifecycle gate

Use this workflow when:

- the EA runs `/startup`, continue, or recall, or
- the EA explicitly invokes, resumes, or dispatches a named project agent, or
- the user explicitly requests vault work.

Do not read or write the vault automatically on ordinary Hi. Mentioning an
agent without invoking it does not start the worker lifecycle.

The latest-work pointer is
`context-vault/ops/ea-briefings/resume-next-session.md`.

## Orient

For `/startup` (EA only, then hold): read `CLAUDE.md`, the latest-work
pointer, the newest `ops/sessions/` note, and ready/blocked
`ops/handoffs/latest-*.md`. Do not dump the vault.

For an EA-invoked named agent, perform these reads at startup without writing:

1. Read `context-vault/index.md` first.
2. Read `context-vault/wiki/agents/<role>.md`.
3. Read the relevant canonical pages under `wiki/`.
4. Read `context-vault/ops/handoffs/latest-<role>.md` and only the newest
   relevant dated handoff or session if the mailbox points at it.
5. Consult `raw/manifest.md` and immutable sources when claims need provenance.
6. Treat code and current runtime evidence as authoritative when a page is stale.

## Record

Perform these writes only while closing an EA-invoked agent task or completing
explicit user-requested vault maintenance:

- Copy user-provided evidence unchanged into `raw/` and register it in
  `raw/manifest.md`. Never edit, rename, or delete an ingested source.
- Put compiled project knowledge in `wiki/projects/caughtup/`.
- Put accepted choices in `wiki/decisions/YYYY-MM-DD-short-title.md`.
- Put concepts, source summaries, and repeatable recipes under their `wiki/` folders.
- Put live continuation in `ops/handoffs/latest-<role>.md`. Archive completed
  notes as `ops/handoffs/YYYY-MM-DD-role-topic.md`.
- Put chronological summaries in `ops/sessions/`.
- Maintain synthesized role memory in `wiki/agents/<role>.md`; never append transcripts.
- Update `index.md` whenever page inventory or scope changes.
- Append ingest, durable query, and lint activity to `log.md`; never rewrite history.

Every invoked agent must create a completed `ops/sessions/` record before returning
to the EA, even if no durable wiki update was needed. Include task, work completed,
verification, durable promotions (or "none"), and next step. Then read the current
role page immediately before merging durable learning. Do not create a session note
at startup.

Read a note immediately before editing it and merge rather than overwrite.
Use wiki-links so every compiled page is reachable from `index.md`.

## Memory quality

Record facts that will change future work: decisions, invariants, exact failure
signatures and fixes, deployment/runtime facts, contradictions, and unresolved
blockers. Exclude secrets, tokens, personal email content, raw logs, speculative
ideas, and routine command narration. Label uncertain or unverified claims and
link evidence.

At closeout, scaffold the completion record and fill it before returning to the EA:

```powershell
powershell -ExecutionPolicy Bypass -File .agents/skills/caughtup-context/scripts/new-session.ps1 -Agent backend-dev -Task "short task" -EAInvoked
```
