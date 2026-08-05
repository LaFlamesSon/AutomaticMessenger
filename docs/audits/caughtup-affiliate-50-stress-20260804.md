# CaughtUp affiliate opportunity 50-case stress test — 2026-08-04

## Closed-loop gate

The benchmark grades ten exact creator niches, ten natural-language category
synonyms, five substring traps, five region boundaries, five difficulty cases,
five earnings-evidence cases, five exclusion/fallback boundaries, and five
comparative ranking cases.

| Gate | Baseline | Final |
|---|---:|---:|
| Fifty-scenario opportunity grade | 27/50 | 50/50 |
| Full Deno policy/opportunity suite | — | 88/88 |
| Extension/API/security contracts | — | 81/81 |
| `agent-api` type-check | — | Pass |

## Root causes fixed

1. A matching platform could select an unrelated category metric. Category
   evidence is now mandatory; platform and sample size only break valid ties.
2. Loose substring checks treated values such as `art` in `smartwatch`, `pets`
   in `carpet`, and `app` in `apparel` as creator-category matches. Matching now
   uses normalized phrase boundaries.
3. Natural product language such as yoga, serum, smartphone, esports, credit
   card, jewelry, luggage, furniture, and dog treats did not connect to the
   creator's corresponding category history. A bounded creator-category
   taxonomy now supports those common relationships.
4. Shipping regions used substring comparisons, so aliases such as US/United
   States and UK/GB failed while US could falsely match Russia. Region matching
   now uses canonical exact keys.
5. Minimum-follower checks could borrow followers from the wrong platform.
   Required-platform eligibility now considers metrics from that platform only.
6. `null` numeric evidence was converted to zero. Missing commission or
   conversion evidence now suppresses earnings estimates, while genuine RPM
   evidence remains an explicitly low-confidence fallback.

## Scope and safety

- The test used deterministic local fixtures; it did not create production
  opportunities, contact brands, send email, alter Auto-send, or read secrets.
- Source improvements were committed as `8e520a4`; production `agent-api` v17
  now contains the improved matcher. A live unsigned Opportunities request
  returned HTTP 401, confirming the function remained reachable and authenticated.
- Extension source 0.4.2 adds an explicit source-status card and manual-product
  wording. Its 400×600 visual fixture passed inspection, and Chrome must reload
  the unpacked extension before the updated UI is visible.
- Live provider catalog quality remains open because no approved TikTok Shop,
  Awin, CJ, or other provider connection is configured yet.
