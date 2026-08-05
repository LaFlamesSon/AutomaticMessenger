# CaughtUp Opportunities v1

## Product promise

Help a creator identify brands that plausibly fit their work, understand why
each match exists, and prepare a personalized Gmail outreach draft for explicit
review. Version 1 does not automatically contact a brand.

## First user journey

1. The user opts in and chooses industries, platforms, collaboration types,
   regions, and brands or categories they never want.
2. The user adds a brand or an HTTPS page on that brand's domain. Future inbox
   sweeps suggest business-domain relationships for the user to confirm.
3. CaughtUp evaluates the brand against the user's services, preferences, and
   media-kit metadata.
4. Opportunities shows the evidence, match score, recommended kit, and one
   proposed collaboration angle. Unsupported facts are never inferred.
5. The user saves or dismisses the match.
6. For a saved match, CaughtUp prepares a Gmail draft and authoritative preview.
   The user must approve the send through the existing manual-send contract.
7. Once the brand replies, the existing inbox workflow takes over.

## Opportunity card

Every card must answer:

- Who is the brand and what is the verified business domain?
- Where did the opportunity come from?
- Why does it match this user?
- Which media kit is recommended, and why?
- What evidence is missing or uncertain?
- Has this brand already been contacted, dismissed, or replied?
- What is the next reversible action?

The initial actions are `Save`, `Dismiss`, and `Prepare draft`. There is no
`Auto-contact` action in version 1.

## Matching contract

Matching is evidence-first and deterministic before any LLM explanation:

1. Exact configured brand or domain match on a media kit.
2. User-selected industry and collaboration-type overlap.
3. Media-kit keyword and bounded description relevance.
4. Existing positive Gmail relationship signal.
5. Geographic/platform compatibility.

The LLM may summarize those signals and propose an angle, but cannot create a
brand claim, contact address, campaign, product launch, budget, or deadline.
Every explanation retains its source fields so it can be audited.

## Proposed owner-scoped data

All tables use UUID primary keys, `user_id` ownership, timestamps, RLS, and
service-role-only access through `agent-api` until a separate authenticated
Data API policy is deliberately introduced.

### `ia_opportunity_preferences`

- `user_id` unique foreign key
- `enabled`
- `industries[]`
- `platforms[]`
- `collaboration_types[]`
- `regions[]`
- `excluded_brands[]`
- `excluded_categories[]`
- `settings_version`

### `ia_opportunities`

- `id`, `user_id`
- `source_type`, `source_ref`, `source_url`
- `brand_name`, `brand_domain`
- `title`, `description`
- `evidence jsonb`
- `match_score`, `match_reasons jsonb`
- `recommended_media_kit_id`
- `status`: `new`, `saved`, `dismissed`, `drafted`, `contacted`, `replied`
- `discovered_at`, `source_published_at`

The source identity is unique per user to prevent duplicate opportunities.

### `ia_opportunity_events`

- `id`, `user_id`, `opportunity_id`
- `event_type`
- `metadata jsonb`
- `created_at`

This append-only history supports duplicate protection and later learning.
Prepared Gmail draft identifiers remain in the event metadata only after an
authoritative Gmail draft is created.

## Source rollout

1. Manually added brands and user-imported controlled lists.
2. Existing owned Gmail relationships and prior collaboration senders.
3. Public brand partnership or affiliate pages supplied by the user.
4. Official marketplace/API integrations where their terms permit it.
5. Licensed business-contact data, only after provenance and suppression rules
   are implemented.

CaughtUp does not scrape closed creator marketplaces or guess personal email
addresses.

## Outbound safety

- Opportunities is opt-in and draft-only in version 1.
- A user must preview every recipient, subject, body, and attachment.
- Never include price, availability, turnaround, acceptance, or rejection.
- Only verified public business contacts or user-supplied recipients qualify.
- One active contact record per user and brand domain prevents duplicates.
- Dismissed, unsubscribed, bounced, or blocked contacts are suppressed.
- A brand reply stops follow-up preparation and returns the thread to Today.
- Email content and imported source text remain untrusted data, never
  instructions.

## Delivery phases

### Phase 1 — creator direction

- Opt in and save creator styles, industries, platforms, collaboration types,
  desired brands, and exclusions.
- Keep Ask CaughtUp in Today so Opportunities remains a focused workflow.

### Phase 2 — relationship memory

- Suggest business-domain senders found during ordinary Gmail sweeps.
- Require the creator to confirm `worked with`, `want to work with`, or
  `not relevant`; Gmail evidence is preserved when they confirm it.

### Phase 3 — controlled sourcing and matching

- Add the preferences and opportunity tables through a named migration.
- Add owner-scoped list/create/save/dismiss API actions.
- Let users add a brand domain or an HTTPS page on that domain and see an
  evidence-based, deduplicated media-kit match.

### Phase 4 — routine refresh

- Manual and scheduled inbox sweeps add new confirmation-required Gmail
  relationship signals when Opportunities is enabled.
- Refresh recomputes scores and kit recommendations from the current profile,
  relationships, and active kits.
- Broad web discovery remains off until a permitted API or licensed source is
  selected; CaughtUp does not claim that a stored URL was independently verified.

### Phase 5 — outreach preparation

- Add one explicit `Prepare draft` action.
- Create a Gmail draft, then require an authoritative live preview and an
  idempotent explicit send action.
- Attach only the selected owner-controlled kit.

## Version 1 acceptance gate

- No cross-user rows or API responses.
- No opportunity without source provenance.
- No automatic external send.
- No duplicate active opportunity for one brand/source.
- No draft without an explicit user action.
- No attachment without an owned, uniquely selected media kit.
- Every state transition is auditable and idempotent.
