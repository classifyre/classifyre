# Product requirements: closing the open-source gaps

These PRDs turn the findings of [palantir-use-case-gap-analysis.md](../../palantir-use-case-gap-analysis.md) into buildable work for the open-source core. The target is traction with enterprises and government in Europe. Governance (sign-in, roles, audit) is the future enterprise edition, so it is not in scope here; [S1](S1-enterprise-extension-seams.md) only adds the seams it will plug into.

**Start with [00 · How the PRDs fit together](00-integration-architecture.md).** It defines:
- the shared foundations (F1–F7) and contracts (C1–C7) the PRDs use;
- the build order and milestones;
- three end-to-end scenarios that prove the pieces work together;
- the engineering rules and the definition of done.

## The PRDs

| PRD | Why (one line) | Size | Milestone | Provides |
|---|---|---|---|---|
| [G0 · Safe defaults](G0-safe-defaults.md) | An instance without a login exposes every secret it found and runs notebook code for anyone | XS–S | M0 | — |
| [S1 · Enterprise extension seams](S1-enterprise-extension-seams.md) | Makes the enterprise edition a module, not a fork of a fast-moving repository | S–M | M0 | F6 |
| [G1 · PYTHON detector](G1-python-detector.md) | Rules and quality checks live in connector notebooks as TAG workarounds (67 of 68 GENESIS detectors) | M | M1 | C1, C2 |
| [G3 · Domain events, webhooks, push, case export](G3-outbound-webhooks-notifications-export.md) | Nothing leaves the app: no webhook, no push, no case export | S–M | M1 | F1 |
| [G2 · European detection coverage and bundles](G2-eu-detection-coverage.md) | National IDs for only 6 of 27 member states, no GDPR Art. 9 detection, no way to share detectors | S–M | M2 | F5 |
| [G4 · Extracted values and watch conditions](G4-extracted-values-and-watch-conditions.md) | Extracted fields can't be searched or used in rules; watches can't express real rules | M | M3 | F2, F3 |
| [G5 · Entities](G5-entities.md) | The flow pivots on strings, never on the things they refer to | L | M4 | F4 |
| [G6 · Triage queue](G6-triage-queue.md) | There is no queue before a case exists | S–M | M5 | — |
| [G7 · Outcome metrics](G7-outcome-metrics.md) | Nothing measures precision, time to decision or the effect of a change | S | M5 | decision log |

## Reading order by role

- **Engineering lead:** 00, then S1, then the PRDs in milestone order.
- **Backend:** 00 §3 (foundations), §5 (contracts), §8 (rules), then your PRD's *Design* section.
- **Frontend:** each PRD's *Web* subsection, plus 00 §8 rules 7 and 15 (namespace links, i18n and status tones).
- **Product and docs:** each PRD's *Why*, *Goals* and *Testing and acceptance*, and 00 §6 (scenarios).

## Status

| PRD | Status |
|---|---|
| [G5 · Entities](G5-entities.md) | Shipped on this branch, 2026-10-03 ([as built](G5-entities.md#13-as-built)) |
| All others | Proposed, 2026-09-30 |

Update this table as PRDs move to *Accepted*, *In progress* and *Shipped*.
