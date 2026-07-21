---
description: Run a QA-verified closed-loop fix for a task too big for one pass — dispatch under ACKNOWLEDGE, prove every fix with REAL invocation output against the live Supabase project, loop to green. Use the speed rules so it's fast.
---

# /closed-loop — verified closed-loop fix for a hard task

Ported from the Mordeaux playbook; verifier adapted to CaughtUp's stack.
Use this when a task is too tricky/large for one pass and needs many
fix→verify cycles (e.g. "drafts are wrong across several categories", a
multi-surface bug class, a migration sweep). You (the EA) drive it; workers
fix; **the qa-agent proves every fix with real output.**

The task to fix is in **$ARGUMENTS**. If empty, ask the user for: (a) the
problem list, (b) the /goal as verifiable conditions, (c) the verifier
(default below).

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
3. **Read first:** `CLAUDE.md` (project state + gotchas — many "new" bugs are
   a known pattern: stripped /functions/v1 prefix, blocked direct curl,
   flaky large deploys, stale chat-history parroting) and the CaughtUp
   Constitution in `.claude/AGENTS.md` (never fix a bug by violating a hard
   constraint).

## THE LOOP — each iteration

1. EA dispatches the next unfixed goal item to the right worker
   (backend-dev / extension-dev / research-agent) under the **ACKNOWLEDGE
   protocol**: worker replies `ACKNOWLEDGED — scope is <one line>. Holding
   for greenlight.` and STOPS until EA greenlights.
2. Worker implements. **Commit to git before any deploy** (HC-8 — the deploy
   channel is flaky; lost deploys must never mean lost code).
3. **qa-agent proves it** with the raw invocation response + DB assertions in
   the transcript.
4. **Accept ONLY on green.** Never on a worker's self-report or a plausible
   description. Remember cron functions return 401 without the right secret
   header — an auth failure in testing is a test-harness bug, not a code bug.
5. On accept: note the fix; if it revealed a reusable pattern, apply the
   Self-Learning Protocol (CLAUDE.md + code comment).

## SPEED RULES (apply every iteration)

1. **Replicate, don't rediscover.** The moment a root cause is confirmed,
   grep the codebase for the SAME anti-pattern and fix EVERY instance in one
   change (e.g. a header-parsing bug in agent-sweep almost certainly exists
   in daily-digest too — they share Gmail helpers by copy).
2. **Batch fixes per deploy.** Deploy is the expensive, flaky unit.
   Accumulate all ready fixes for a function → ONE deploy → ONE verification.
3. **Verify at the cheapest decisive layer first.** DB query (s) →
   function invocation via pg_net (s–min) → extension-reload user check
   (needs Yafet, ACCEPTANCE ONLY).
4. **Fan out by independent surface**, not just by role — parallel workers
   per pattern-instance. Serialize only deploys to the SAME function.
5. **Distinguish data-gap from code-bug.** An empty digest may mean an empty
   inbox — confirm via `ia_processed_emails` before "fixing" code. Adjust
   the goal to reflect data reality honestly; don't move the goalpost.
6. **Never verify against a stale version.** After deploy, confirm the
   version bump via `list_edge_functions` before running the gate.

## GUARDRAILS

- Cap 40 iterations. Halt if the same fix fails 3× in a row. Halt + report
  if the verifier can't run.
- Migrations are audit-gated per `.claude/AGENTS.md`: draft the migration,
  get Yafet's authorization, then `apply_migration` — never ad-hoc DDL.
- Never touch Vault secrets, `ia_users.api_token` values, or live Gmail
  refresh tokens as part of a fix without explicit authorization.
- Never flip `auto_send` on any profile as part of testing (HC-2).

## STOP

Quit by saying STOP three times if the goal genuinely cannot be achieved or
measured — then report why + the exact blocker.

## ON COMPLETION (or STOP)

Report to Yafet: goal checklist with per-item verdicts (each backed by real
output), what was deployed (function + version), what remains. Capture any
new recurring bug pattern via the Self-Learning Protocol.
