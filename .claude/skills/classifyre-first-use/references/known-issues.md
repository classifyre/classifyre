# Known issues: what to verify, what to skip

## Contents

- [How to use this file](#how-to-use-this-file)
- [Regression watch list — fixed, unproven in the field](#regression-watch-list--fixed-unproven-in-the-field)
- [Still open — confirm and move on](#still-open--confirm-and-move-on)
- [Closed as not-reproducible](#closed-as-not-reproducible)
- [Product judgment issues that are not bugs](#product-judgment-issues-that-are-not-bugs)

---

## How to use this file

Two jobs:

1. **Don't waste the run rediscovering known bugs.** Confirm in a line and move on. Novel information is what justifies the run.
2. **Actively try to break the recent fixes.** Everything in the watch list below was fixed after the first run and verified only by unit tests and a Postgres-level check. **None of it has been proven against a real corpus.** If one has regressed, that is very likely the most important thing you will find — these are the bugs that silently destroyed investigative state.

State the build under test next to every verdict here. A fix verified on the wrong build is worse than no verification.

---

## Regression watch list — fixed, unproven in the field

Shipped in **v0.4.54 (PR #195)** and **PR #197**. For each: what it was, and the signal that proves it works now.

### Asset lifecycle — the ones that destroyed data

| Was | Verify now |
|---|---|
| **Narrowing a populated source's scope retired every out-of-scope asset and auto-resolved its findings** (G-019). A one-document experiment retired nine assets; an active inquiry fell 8 → 0. | Assets carry a scope fingerprint. Narrow scope on a populated source with `ALL`: expect **zero deletions**, findings still OPEN, and a non-zero **`assetsOutOfScope`** on the runner. |
| **A zero-result `ALL` scan wiped the source** — with no seen hashes the exclusion filter was dropped entirely, matching every asset. | Point a populated source at an empty/bad path and scan `ALL`. Expect **zero deletions** and an explicit "zero assets seen" warning. |
| **Adding a detector auto-resolved another detector's still-valid findings** (G-021). Nine assets kept only the new detector's findings; all eight verified legal references were wrongly resolved. | Scan with detector A, add detector B, rescan. **A's findings stay OPEN.** Resolution is now scoped by `detector_outcomes` per (asset, detector). |

### Run honesty

| Was | Verify now |
|---|---|
| **A run reported `COMPLETED` / "0 errors" while PII failed on every page** (G-014). | A crashed detector now yields **`WARNING`** and an error message naming the detector. `scan_stats.detector_outcomes` carries per-detector `OK`/`ERROR` with custom-detector-key granularity. |
| **Counters meant something other than their name** (G-012/G-020). A ten-asset first run reported `assetsCreated: 0, assetsUnchanged: 10`, because counts came from mutable asset status and the CLI ingests in two passes. | Counters now derive from an immutable per-run `change_type`. A first run of N assets should report **`assetsCreated: N`**. `totalFindings` is still "findings associated with this run"; **`findingsCreated`** is the real discovery count. |
| **Empty OCR was invisible** (G-030) — 718 empty OCR calls, zero errors, run green. | `scan_stats.empty_text` and the runner's **`assetsWithoutText`**. Deliberately *not* an error and *not* a WARNING — blank pages are legitimate. A high value means the corpus is largely unscanned; read it before trusting any finding count. |
| **Log severity was noise** (G-031) — stderr defaulted to ERROR, though Python logs every level there, so model-download chatter buried real failures. | Levels are read only from a leading prefix or a timestamped field. Unclassifiable lines are `UNKNOWN`, not `ERROR`. Tracebacks are still `ERROR`. |

### Detectors

| Was | Verify now |
|---|---|
| **PII crashed on every page with valid chunking config** (G-011) — `unsupported operand type(s) for -: 'ChunkSize' and 'ChunkOverlap'`. Run still reported success. | Set `chunk_size`/`chunk_overlap` and confirm PII produces findings. `max_length` had the same defect. |
| **GLiNER2 classification always failed** (G-008) — called a method the library does not have, and the shared error handler discarded entities extracted in the same run. | Classification produces findings; a classification failure no longer discards entities. Note a second defect was fixed behind it: confidences were read from the wrong key, so classification would have silently scored 0.0 and been threshold-filtered even after the method fix. |
| **PII severity defaulted unlisted entities to `high`** (G-034), inflating the histogram with no review. | Default is `medium`; `severity_overrides` lets you set per-entity severity. Severity still describes the *label*, never evidence quality. |

### Autopilot

| Was | Verify now |
|---|---|
| **Summaries counted reads as work** (G-032) — "11 applied" with `decisionCount: 0`. | Reads report `READ_OK`; summaries read `N applied; M read; …`. Cross-check `applied` against persisted decisions. |
| **Cancellation was not terminal** (G-029) — a cancelled run finalised as `COMPLETED` with "Cancelled by the operator" still in its error field. | Cancel mid-run; it stays `CANCELLED`. |
| **Disabling agents did not stop a running cycle** (G-027/G-029) — settings were read once per cycle, and a targeted rerun bypassed the switches entirely. | Disable an agent mid-cycle; subsequent agents in that cycle skip. Settings are re-read per agent. |
| **Agent memory raced and last-writer-won** (G-018), producing false source profiles. | Writes are a single atomic upsert; tags merge rather than clobber. |
| **A superseded runner read as an empty source** (G-026) — a CONFIG run wrote a false "0 assets and 0 findings" memory for a source holding 13 assets and 3,239 findings, then triggered a pointless rescan. | `assets.profile` now always returns **`sourceTotals`** (live activeAssets/openFindings) plus **`runnerSuperseded`**. Reviewing an old runner should show `totalAssets: 0` *beside* non-zero `sourceTotals`. `totalAssets` is now a real count, not a capped sample. |

---

## Still open — confirm and move on

Do not spend the run on these. A line in the ledger confirming they persist is enough.

| ID | Issue |
|---|---|
| **G-016b** | **240× storage amplification.** Every finding on a page stores a copy of that page's whole entity dump — measured at 3.2 MB/page where 13.7 KB would do. Half fixed (the `findings.metadata` copy is gone); the per-finding extraction row remains. Deferred to the semantics PR, which builds the content-addressed storage this needs. |
| **G-022** | GLiNER entity findings report **0% extraction coverage** — it stores entities as ordinary findings with repeated pipeline metadata rather than `extracted_data`, so the coverage metric is meaningless for an otherwise-working detector. Use finding search instead. |
| **G-028** | The deterministic **DUPLICATES worker has no enable/disable toggle** — `PATCH /autopilot/agents/DUPLICATES` returns 400 `Unknown agent`. It runs even when every configurable agent is paused. |
| **G-001** | `validate_detector_config` rejects valid bare pipeline schemas (`oneOf` error). Validate locally. |
| **G-002** | Local-folder schema says `rows_per_page` is tabular-only; the runtime uses it for all strategies. |
| **G-003** | `RANDOM` sampling is seeded with 0 — re-runs select the same objects. |
| **G-005** | No autopilot/system-brief tools on MCP. REST fallback for the whole agent layer. |
| **G-009** | `run_detector_tests` can exceed the MCP client's ~300 s limit though the server persists results. |
| **G-010** | MCP can create/list detector test scenarios but cannot delete one. |
| **G-013** | Per-run asset progress is REST-only. |
| **G-017** | Correlation graph is REST-only. |
| **G-023 / G-024** | Sandbox: a PDF upload produced zero findings where text succeeded; run responses inline file bytes as an integer-keyed JSON object. **The sandbox is slated to become a source type** — confirm what exists on your build before reporting. |
| — | **Coverage:** one local dataset was never configured as a source in the first run. If you inherit that corpus layout, decide explicitly rather than silently omitting it. |

---

## Closed as not-reproducible

**G-016 — correlation "inflating counts" and >100% duplicate scores.** Reported as 3,808 shared Bates numbers against 427 real, and a 45.46 / "4546%" match.

Do not re-report this without a runnable reproduction. It was investigated to the bottom:

- The stated cause (correlation re-indexing each finding's embedded page entities) is **factually wrong** — the value index reads five scalar columns and never touches finding metadata.
- Verified against PostgreSQL 16 with the real numerator/denominator SQL: two assets sharing 427 Bates numbers return `sharedCount = 427`, `weighted = 0.8952`. Bounded.
- The reported *shape* was then reproduced by **removing the dedup** — dropping the unique constraint and indexing each value ~9× gives `sharedCount = 34,587`, `weighted = 8.88`. So the hypothesis was right about the class of bug, and the current build prevents it.
- Conclusion: the tested instance ran a pre-fix build.

**The lesson generalises: record your build.** This cost real investigation time purely because the first run's ledger did not say what was running.

If you do see a duplicate score above 100%, that is a genuine regression and a serious one — capture the source values and the runner, not just the score.

---

## Product judgment issues that are not bugs

These are design problems the first run surfaced. They will not appear as errors. Notice whether they still bite:

- **Severity ≠ evidence quality.** Every `CRITICAL` was a `CREDIT_CARD` recognizer hit on repeated-digit OCR artifacts. Nothing was wrong; the label just does not mean what a reader assumes.
- **Correlation scores are leads, not rankings.** Thin 100% matches (two assets sharing one person value) are possible by construction.
- **High volume ≠ importance.** The two datasets with the most findings were simply the ones with the longest documents.
- **The tool surfaces candidates; it does not explain why one matters.** This is the central complaint. If it still holds, say so plainly.
