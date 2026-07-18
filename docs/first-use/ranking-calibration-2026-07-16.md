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
