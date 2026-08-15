---
name: caughtup-closed-loop
description: Drive a difficult CaughtUp bug or multi-surface change through explicit, testable conditions and repeated fix-verification cycles. Use when a task spans backend and extension surfaces, has already failed more than once, risks email or production state, or the user explicitly asks for a closed loop, persistent verification, or work until green.
---

# CaughtUp Closed Loop

## Define the gate

1. Convert the request into a problem list and a checklist of observable pass
   conditions.
2. Choose the cheapest real verifier for each condition: static check, unit test,
   local runtime, read-only database/API evidence, then user-visible browser/email.
3. Mark unavailable verification as open or blocked; never silently skip it.
4. Identify any condition requiring live writes, deployments, sends, migrations,
   secret access, billing changes, or `auto_send` changes and obtain explicit user
   authorization before that action.

## Iterate

1. Establish a failing baseline when safe.
2. Find the root cause using the cheapest decisive layer.
3. Search the repository for sibling instances of the same pattern.
4. Make the smallest coherent fix and inspect the diff.
5. Re-run local checks, then the authorized live verifier if needed.
6. Accept a condition only on captured evidence, not an agent self-report.

Batch changes that share an expensive deployment, but keep unrelated fixes
separate. Confirm the deployed version before attributing live results to new code.
Stop and report if the same approach fails three times or the verifier is unavailable.

## Close

Report every condition as Pass, Fail, or Open with its evidence. Use
`$caughtup-context` to save only durable root causes, decisions, and next steps.
