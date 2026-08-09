# Creator negotiation memory and no-send harness — 2026-08-09

## Outcome

Creator negotiation memory is deployed and three synthetic negotiation states
are live for `yafet2132@gmail.com`. Reloading extension source version 0.5.0
shows them at the top of Today as manual-review cards.

The harness is intentionally incapable of touching Gmail. Its records use
`qa-negotiation:*` thread IDs, `qa-negotiation-message:*` message IDs, and
`is_test=true`. No `ia_processed_emails` fixture was inserted, no Gmail API was
called, and no Auto-send, OAuth, token, or existing media-kit object was
changed.

## Live deployment

- Source commit: `b51bbd3` (`Add creator negotiation review workflow`)
- Harness commit: `8555a40` (`Add no-send negotiation live harness`)
- Schema migration: `20260809210839_creator_negotiation_memory.sql`
- Harness migration: `20260809213000_seed_yafet_negotiation_harness.sql`
- `agent-sweep`: active version 34
- `agent-api`: active version 21
- Extension source: 0.5.0

Both migrations appear in the linked local/remote migration ledger. The
harness migration completed successfully, which also verifies that the target
Gmail account and an active owned media kit existed; its strict selectors would
otherwise have aborted the migration.

## Scenarios visible in Today

1. Brand counteroffer below the pinned media-kit minimum.
2. Revised terms within the floor/target range.
3. A new offer at or above the target.

All three require creator review. Test records intentionally have no Open Gmail
or send action. Existing rate thresholds are preserved. When no rate profile
existed, an insert-only demonstration profile was added with a note beginning
`Temporary no-send negotiation harness thresholds`.

## Verification

- `npx deno check` passed for `agent-sweep` and `agent-api` before deployment.
- Extension tests passed 46/46.
- Source/security contract tests passed 50/50.
- Full Deno suite passed 142/142.
- Negotiation-focused Deno tests passed 6/6.
- `node --check extension/popup.js` passed.
- Linked migration dry-run selected only the intended negotiation schema
  migration, then the live push succeeded.
- Linked harness dry-run selected only the intended harness migration, then the
  live push succeeded.
- Supabase function listing confirms active versions 34 and 21.

The extension-authenticated response still needs a user-visible confirmation
after Chrome reload because the session credential remains inside Chrome
storage and was deliberately not extracted for command-line testing.

## Cleanup boundary

Leave the fixtures present until the user confirms the Today display. Cleanup
must delete only rows where `is_test=true` and `thread_id like
'qa-negotiation:%'`. The demonstration rate profile may be deleted only when
its exact harness note is present; a user-edited or pre-existing profile must
never be removed.
