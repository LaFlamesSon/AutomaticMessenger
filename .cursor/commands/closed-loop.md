---
description: Run a QA-verified closed-loop fix — dispatch under ACKNOWLEDGE, prove every fix with REAL invocation output, loop to green.
---

# /closed-loop — verified closed-loop fix for a hard task

Ported from the Mordeaux playbook; verifier adapted to CaughtUp's stack.
Use this when a task is too tricky/large for one pass and needs many
fix→verify cycles. You (the EA) drive it; workers fix; **the qa-agent
proves every fix with real output.**

The task to fix is in **$ARGUMENTS**. If empty, ask the user for: (a) the
problem list, (b) the /goal as verifiable conditions, (c) the verifier
(default below).

Canonical workers only: `database-agent`, `backend-dev`, `frontend-dev`,
`qa-agent`, `research-agent`. `extension-dev` is an alias of `frontend-dev`.
Dispatch with the Cursor Task tool plus `context-vault/ops/handoffs/latest-<role>.md`.

**Cursor Task `model` (required):** `database-agent`, `backend-dev`,
`frontend-dev` → `composer-2.5-fast`; `qa-agent` → `cursor-grok-4.6-high-fast`;
`research-agent` → `inherit`. Never use a weaker model as the quality gate.
Codex workers use `.codex/agents/*.toml`; vault handoffs are the Cursor↔Codex bus.

---

## PHASE 0 — set up before any fixing (do once)

1. **Restate the task** as: the PROBLEM LIST + a **/goal = a checklist of
   conditions, each provable by a REAL execution** (not a description, not a
   worker's claim).
2. **The verifier (non-negotiable).** Default for this project: the qa-agent
   triggers the deployed function via
   `select net.http_post(url := '.../functions/v1/<fn>', headers := ...)`
   through `execute_sql`, reads the actual response from
   `net._http_response`, and asserts the resulting DB state
   (`ia_agent_runs.status = 'ok'`, expected `ia_processed_emails` rows,
   `ia_chat_messages` content, etc.). For extension/UI conditions the
   verifier is Yafet reloading the extension and confirming — queue those
   conditions and batch them into ONE user check at the end. Fail-closed:
   if the verifier can't run, the condition is RED, never skipped.
3. **Read first:** `CLAUDE.md` and the CaughtUp Constitution in
   `.claude/AGENTS.md` (never fix a bug by violating a hard constraint).

## THE LOOP — each iteration

1. EA dispatches the next unfixed goal item to the right worker
   (`database-agent` / `backend-dev` / `frontend-dev` / `research-agent`)
   under the **ACKNOWLEDGE protocol**: worker replies
   `ACKNOWLEDGED — scope is <one line>. Holding for greenlight.` and STOPS
   until EA greenlights. This explicit dispatch starts that worker's
   Obsidian memory lifecycle: read role context at startup and write one
   completion record before returning to the EA.
2. Worker implements. **Commit to git before any deploy** (HC-8).
3. **qa-agent proves it** with the raw invocation response + DB assertions
   in the transcript.
4. **Accept ONLY on green.** Never on a worker's self-report or a plausible
   description. Cron functions return 401 without the right secret header —
   an auth failure in testing is a test-harness bug, not a code bug.
5. On accept: note the fix; if it revealed a reusable pattern, apply the
   Self-Learning Protocol (`CLAUDE.md` + code comment).
   Do not accept a worker result until its `context-vault/ops/sessions/`
   closeout record exists. A later dispatch starts a new lifecycle and gets
   a new record.

## SPEED RULES (apply every iteration)

1. **Replicate, don't rediscover.** Grep the same anti-pattern and fix every
   instance in one change.
2. **Batch fixes per deploy.** Accumulate ready fixes for a function → ONE
   deploy → ONE verification.
3. **Verify at the cheapest decisive layer first.** DB query → function
   invocation via pg_net → extension-reload user check (Yafet, ACCEPTANCE
   ONLY).
4. **Fan out by independent surface.** Serialize only deploys to the SAME
   function.
5. **Distinguish data-gap from code-bug.** Confirm via `ia_processed_emails`
   before "fixing" an empty digest.
6. **Never verify against a stale version.** After deploy, confirm the
   version bump before running the gate.

## GUARDRAILS

- Cap 40 iterations. Halt if the same fix fails 3× in a row. Halt + report
  if the verifier can't run.
- Migrations are audit-gated: database-agent drafts the migration, Yafet
  authorizes, then apply — never ad-hoc DDL.
- Never touch Vault secrets, API tokens, or live Gmail refresh tokens
  without explicit authorization.
- Never flip Auto-send on any profile as part of testing (HC-2).

## STOP

Quit by saying STOP three times if the goal genuinely cannot be achieved or
measured — then report why + the exact blocker.

## ON COMPLETION (or STOP)

Report to Yafet: goal checklist with per-item verdicts (each backed by real
output), what was deployed (function + version), what remains. Capture any
new recurring bug pattern via the Self-Learning Protocol.
