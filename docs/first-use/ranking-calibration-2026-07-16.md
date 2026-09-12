# Evidence-Ranking Calibration — 2026-07-16

Calibration pass over the importance/quality ranking introduced by the
semantics branch, run against a full copy (`classifyre_calib`) of the live
33,545-finding corpus. Three recalibration passes were executed; the scorer
changed between each pass based on what the data showed.

## Defects found and fixed

1. **Order-dependent neighbourhood analysis (systemic).**
   Neighbourhood calibration ran only at vector-insert time. The first vectors
   analyzed saw a nearly empty space, computed mean neighbour similarity from
   1–2 neighbours (observed: two findings sharing the identical
   `meanNeighborSimilarity` because each was the other's only neighbour), were
   flagged extreme semantic outliers, and kept that bonus forever. 99.7% of
   analyses carried a non-zero outlier signal.
   **Fix:** a full-space recalibration pass (`EmbeddingService.recalibrateSpace`)
   now runs automatically when the embedding inference queue drains (debounced
   pg-boss singleton job, 120s), after every backfill, and manually via
   `apps/api/scripts/recalibrate-embeddings.ts`. Sparse neighbourhoods
   (< 5 same-type neighbours) no longer produce any outlier adjustment
   (`insufficient_neighborhood` reason instead).

2. **Noise floor too high.** Unreadable OCR fragments kept full novelty +
   severity + confidence points and landed mid-table (~0.5).
   **Fix:** below quality 0.45 the whole score scales by `quality / 0.45`.

3. **All duplication penalized; cross-document recurrence unrewarded.** The
   retrospective's #1 valuable signal — the same exact value appearing in
   multiple documents — had no effect on importance.
   **Fix:** `cross_document_recurrence` bonus (+0.12) when the normalized
   matched value appears in 2–25 assets **in different contexts**
   (same-context repeats are template copies and stay penalized);
   `common_value` penalty (−0.10) above the 25-asset hub cap.

4. **Recognizer noise ranked as evidence.** Documented payment-network test
   numbers (e.g. `4012 8888 8888 1881`) and repeated-digit strings scored ~0.9
   with CRITICAL severity.
   **Fix:** `known_test_value` (−0.25) against the canonical test-number list;
   `repeated_digit_pattern` (−0.20) for ≥8-digit strings with ≤2 distinct
   digits. Both disqualify the recurrence bonus.

5. **"Semantic outlier" flagged half the corpus.** With MiniLM over diverse
   evidence text the corpus-median outlier strength is ~0.30; the old 0.35
   reason threshold made the flag meaningless.
   **Fix:** bonus/reason bar moved to the top decile (0.55), and the bonus now
   requires a matched value of ≥ 5 characters (a 4-char OCR token is weak
   evidence however unusual its embedding looks).

## Results (33,545 findings, before → after)

| Signal | Pass 0 (shipped) | Final pass |
| --- | --- | --- |
| Findings flagged `semantic_outlier` | ~33,400 (99.7%) | 3,073 (9.2%) |
| `cross_document_recurrence` flags | n/a → 7,154 (pass 2, inflated by fixtures) | 45 (different-context only) |
| CREDIT_CARD avg importance | 0.840 | 0.805 (test values penalized) |
| DATE_TIME (noisiest class) avg | 0.719 | 0.690 |
| Rich content (`description`) avg | 0.946 | 0.897 |
| Bottom of ranking | timestamps at 0.52, "=" at 0.39 | common values + near-dups stacked to 0.46, OCR at 0.39 |
| Top 10 | OCR-caps tokens + bibliographic boilerplate at 1.0 via bogus outlier bonus | real content; reasons truthful |

## Known residuals

- Short capitalized tokens ≥ 5 chars (e.g. `BURNS`) can still reach the top via
  the outlier bonus; the ≥5-char guard is a blunt instrument.
- The recurrence hub cap (25 assets) and all weights remain hypotheses; this
  corpus is a mixed test corpus, **not** the original 3.1 GiB first-use corpus.
- The corpus gate from `remediation-verification.md` still requires a fresh
  scan of the original corpus (asset chunks only populate on scan) and an
  analyst top-50 review.

## Operational notes

- Recalibration of 33.5k findings takes ~35–45 min at default settings; it is
  a background job and safe to re-run.
- `finding_evidence_analyses.signals` now records `crossAssetCount`,
  `crossSourceCount` and `valueLength` alongside the existing signals, so every
  score remains explainable from persisted data.

## Follow-up: recurrence bonus awarded, bars re-tuned 0.75 → 0.85 (2026-09-12)

The reason/bonus split is closed: `crossDocumentLead` is now
`crossDocumentRecurrence`, so the +0.12 follows the wider reason set. Shipped
in the same change, as the original follow-up required: `EXPRESS_IMPORTANCE_SCORE`
and `UNMONITORED_MIN_IMPORTANCE` 0.75 → 0.85, the case-leads
`MIN_INQUIRY_IMPORTANCE` with them (a third 0.75 on the same "high importance"
standard — leaving it behind would recreate the drift inside lead proposals),
and the `harnessExpressImportance` column default 0.75 → 0.85 for new rows
only. Stored 0.75 rows are not migrated — the dial may be deliberate — so an
install that never chose the value should move it by hand.

### Methodology: SQL simulation, not a full recalibration

Threshold selection did not need the 10+ hour rewrite pass below. Eligibility
mirrors the analyzer exactly — value spread of 2–25 distinct assets over the
same normalization, value length ≥ 4, `similar_count > 0` — and the simulated
score is `LEAST(1, old + 0.12)`, which is what the code adds after quality
scaling. Two approximations, both negligible here: the known-test-value and
repeated-digit exclusions are omitted (no such rows appear in the crossing
set's type breakdown), and the live minimum quality is 0.690, so quality
scaling touches nothing. Measured on `firmenbuch-test-2`, 605,935 analyses
(the corpus grew since the 603,633-figure revision: eligible 148,231 vs
147,823; newly crossing 0.75 now 67,968, of which 66,961 company numbers).

Before → after, simulated:

| bar | before (live) | after bonus |
|---|---:|---:|
| findings ≥ bar, bar = 0.75 | 20,956 | 88,924 |
| findings ≥ 0.80 | 11,373 | 40,185 |
| findings ≥ 0.81 | 1,002 | 17,605 |
| findings ≥ 0.82 | 911 | 17,488 |
| findings ≥ 0.83 | 837 | 4,153 |
| findings ≥ 0.84 | 758 | 3,954 |
| findings ≥ 0.85 | 668 | 3,862 |
| findings ≥ 0.86 | 582 | 696 |

The cliffs are load-bearing, not noise: structured extraction gives identical
context lengths to whole cohorts, so scores fall on discrete lumps
([0.80, 0.81), [0.82, 0.83), [0.85, 0.86)). Count-matching is therefore
impossible — no bar restores 20,956 — and the choice has to be anchored to
behaviour instead:

- **Express lane (per-scan bypass).** 272 runners with findings: 137 carry a
  ≥ 0.75 finding today (50% bypass). Post-bonus that is 251 at 0.75 (92% —
  batching defeated, nearly every filing carries a company number), 239 at
  0.80, and **146 at 0.85 (54%)** — the calibrated bypass rate restored. This
  is the anchor the 0.85 rests on.
- **Top of the queue is untouched.** The 300th finding scores 0.907; 61 new
  rows cross above it. The bonus moves the middle of the ranking, not the top.
- **Severity mix is preserved in shape.** Before ≥ 0.75: MEDIUM 15,034 /
  CRITICAL 2,648 / LOW 2,530 / INFO 595 / HIGH 149. After, ≥ 0.85: MEDIUM
  3,178 / CRITICAL 509 / INFO 93 / HIGH 76 / LOW 6.
- **0.86 was considered and rejected.** It restores the count almost exactly
  (696 vs 582) but starves the watch pool with no behavioural anchor, and it
  would exclude ungrouped findings the old bar deliberately included.

### Residuals, honestly

- ~3.1k higher-context company numbers still clear 0.85 — as ~14.8k unique
  ones already cleared 0.75 before this change. The bar rations attention; it
  never excluded identifiers, and still does not. Company-number max after
  bonus is 1.0, p99 0.854.
- `RECURRENCE_HUB_CAP = 25` vs `BOILERPLATE_GROUP_BREADTH_CAP = 2000` remain
  hypotheses, now with a reconciliation note in `STORAGE_RECLAIM.md` saying
  what each cap measures and what would settle each.
- Scores land only as recalibration rewrites rows (the bonus is *written*),
  so the corpus reads mixed until the pass below completes.

### Budget for the rollout

33.5k findings recalibrate in ~35–45 min; this corpus is ~606k, **18×, so
10.5–13.5 hours** for the rewrite pass that lands the new scores and reasons.
The simulation above cost minutes and is sufficient for threshold selection —
reserve the full pass for the rollout itself, then run the operational
`VACUUM (FULL, ANALYZE)` on `finding_evidence_analyses`, since a 600k-row
rewrite pass leaves the same bloat the last one did.
