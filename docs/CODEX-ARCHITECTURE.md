# Codex Environment Architecture

## What was retained from the Claude setup

- Stable specialist roles with explicit ownership
- Persistent handoff artifacts
- Verification before acceptance
- A warm-context Obsidian vault with per-role memory
- A closed-loop workflow for difficult fixes

## What changed for Codex

| Claude surface | Codex implementation |
|---|---|
| `.claude/CLAUDE.md` | Root `CLAUDE.md` remains project-state input; `AGENTS.md` is durable Codex guidance |
| `.claude/agents/*.md` | `.codex/agents/*.toml` custom agents |
| `.claude/commands/*.md` | `.agents/skills/*/SKILL.md` repo skills |
| Claude settings/MCP | Project `.codex/config.toml` |
| Mordeaux vault paths | OneDrive-backed Obsidian vault, linked at repo `context-vault/` |

Custom Codex prompts were not used because current Codex guidance deprecates
them in favor of skills. Hooks were also omitted: the useful controls here are
semantic safety rules that require context, while a future hook should enforce
only a deterministic policy with a tested script.

## MCP policy

The Supabase MCP is scoped to project `xkrpxvswdkreglmefuot` and read-only by
default. No API keys are stored in the repository. Writable database changes,
deployments, secret changes, email sends, and billing actions remain explicit,
user-authorized operations.

The Stitch MCP from the export was intentionally not copied: it is unrelated to
CaughtUp and the export embedded a credential directly in configuration.

## Memory architecture

The OneDrive Obsidian vault follows an LLM Wiki model:

- `raw/` preserves immutable user-provided sources and hashes.
- `wiki/` holds compiled project, concept, source-summary, decision, and agent pages.
- `ops/` holds chronological sessions, handoffs, and temporary inbox notes.
- Vault `AGENTS.md` defines ingest, query, lint, provenance, and memory rules.
- `index.md` catalogs content; `log.md` is append-only chronology.

Agent memory is synthesized by role. Routine session history stays in `ops/` and
only reusable knowledge is promoted into a canonical agent page.

## Use

1. Trust the repository in Codex so `.codex/config.toml` loads.
2. Start a new Codex chat so project agents and skills are rediscovered.
3. Authenticate the Supabase MCP when prompted.
4. Open `C:\Users\yafet\OneDrive\Desktop\CaughtUp` as the Obsidian vault.
5. Invoke `$caughtup-context` for orientation or durable memory and
   `$caughtup-closed-loop` for difficult, verification-heavy work.

## Codebase findings

- The hosted Supabase/extension product is the active architecture; Python is legacy.
- `README.md` and `CLAUDE.md` describe different product generations.
- There is no checked-in automated test suite.
- Edge Functions duplicate helper code, increasing drift risk.
- Extension dynamic HTML handling deserves a focused security pass.
- Production version/health claims require live re-verification.
