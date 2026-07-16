# Post-First-Use Remediation Verification

Verified against `fix/polishing` on 2026-07-15.

## Verdict

The branch now answers the retrospective's product question in implementation:

> The next step is not "extract more." The next step is "rank and explain better."

Ranking is no longer severity ordering with a vector score attached. Findings
have a separate evidence analysis containing importance, evidence quality,
duplicate count, semantic outlier strength, observable signals, and plain-language
reasons. The findings UI defaults to importance ordering, shows the reasons and
groups repeated evidence transitively, so A-similar-to-B and B-similar-to-C
form one deterministic group. Finding detail explains the score while presenting
severity separately. MCP receives the same ranking fields and reasons and can
search semantically, find neighbours, and inspect boilerplate clusters.

The honest qualification is that this is **implemented, not yet calibrated on
the original 3.1 GiB corpus**. The software now has the required judgment loop;
the real answer becomes proven only after the original corpus is rescanned and
an analyst compares the new top 50 with the retrospective's known useful and
noisy examples.

## Implementation Status

| Area | Status | Verification |
| --- | --- | --- |
| Store correctness | Implemented | Scope fingerprints and zero-result protection prevent false deletion. Finding reconciliation is detector-scoped. Runner changes and finding deltas use per-run state. Database-backed e2e tests reproduce scope narrowing, a zero-result full scan, detector addition, and hand-computed terminal counters. Unit regressions cover PII, GLiNER, log severity, inquiry counters, and autopilot terminal/accounting bugs. |
| Operational truth | Implemented | Runner UI separates created, retained, and resolved findings plus created, updated, unchanged, deleted, and out-of-scope assets. Detector failures produce `WARNING`. Text coverage distinguishes `EXTRACTED`, legitimate `EMPTY`, `ENGINE_UNAVAILABLE`, `ZERO_FRAMES`, `FAILED`, and `NOT_APPLICABLE`, and scan detail renders those states explicitly. Source transport failures remain fatal. |
| Vector store | Implemented | Content-addressed spaces, vectors, chunks, and evidence analyses. pgvector uses a 384-dimensional vector mirror plus HNSW. Plain PostgreSQL and selective source filters use normalized `float8[]` exact cosine, avoiding HNSW post-filter recall loss. |
| Intrinsic embeddings | Implemented | Every text-bearing ingestion path chunks and hashes content, negotiates missing hashes, uploads bounded vector batches, and links finding context hashes. No detector is required. Reused vectors re-run analysis for newly attached findings instead of leaving them pending. |
| Ranking and noise analysis | Implemented, calibration pending | Importance and quality are separate from severity. Exact/near repetition, local coherence, OCR-like quality, context, confidence, and semantic outlier signals produce persisted reasons. Duplicate rows are grouped in the findings workflow. A database e2e proves exact duplicates, near duplicates, outlier explanation, and similar-evidence retrieval. |
| Semantic search | Implemented | Findings and assets support exact, hybrid, and vector modes. Hybrid combines lexical and semantic ranks with RRF and degrades to lexical when the query embedder is unavailable. |
| MCP | Implemented | Search tools accept semantic mode and return explanations. `find_similar_findings` and `find_boilerplate_clusters` are available. Tool descriptions warn that similarity is not proof. |
| Ranking UI | Implemented | Importance is the default finding sort. Rows show score, quality, reasons, and similar count; detail has evidence-ranking explanation; semantic/exact controls are explicit. |
| FEATURE_EXTRACTION | Retired | Embeddings are infrastructure rather than a user-authored detector. Schema, CLI, API, web, MCP, docs, and generated clients no longer expose the detector type. Historical migrations retain the old enum name as expected. |
| Sandbox consolidation | Deliberately excluded | Sandbox remains unchanged, per the implementation scope for this branch. |

There is no backfill or legacy-vector migration in this branch because there is
no production or compatibility data to preserve. Asset chunks and finding
vectors are populated by new scans.

## Step 0 Measurements

The first-use desktop database was measured without changing corpus state:

- 68,987 findings produce 44,981 distinct hashes from normalized finding
  context, a 34.8% content-address collapse;
- the plan's estimate of roughly 35,000 unique finding vectors was low by about
  10,000;
- a raw exact scan of 44,981 rows at 384 dimensions took 2.19 seconds for a
  top-100 result on the embedded database.

The fallback therefore remains a correctness path, not an ANN substitute at
large unfiltered cardinalities. Asset search prefilters through chunk/source
joins. Further fallback tuning should be driven by the corpus rerun rather than
an invented threshold.

Fresh-database migration verification passed on both deployment shapes:

- `pgvector/pgvector:0.8.2-pg18-bookworm`: vector 0.8.2, `vector(384)` mirror,
  and `content_embeddings_vec_hnsw_idx` present;
- `postgres:18-bookworm`: migration succeeds without the extension or vector
  column and keeps `float8[]` storage;
- the desktop staging script compiled pgvector 0.8.2 against the bundled
  PostgreSQL 18 runtime and a fresh embedded instance accepted
  `CREATE EXTENSION vector`; the staged server reported vector 0.8.2 and
  returned cosine distance `1` for orthogonal vectors;
- Helm renders an embedding sidecar and pgvector-capable PostgreSQL for both
  the embedded and CloudNativePG configurations.

## Implemented Judgment Contract

Every finding search result exposes:

```text
ranking: {
  importance: 0..1 | null,
  quality: 0..1 | null,
  similarCount: number,
  duplicateGroupHash: string | null,
  reasons: [{ code, label, impact }],
  coverage: "analyzed" | "pending",
  reciprocalRank?: number,
  semanticSimilarity?: number
}
```

The persisted analysis also records semantic outlier strength and its input
signals. `detectorConfidence`, `severity`, evidence quality, and importance stay
separate. Similarity contributes to retrieval and explanation; it is not
presented as evidentiary proof.

The API stores normalized scores in `0..1`; the UI renders them as `0..100`.

The current score is intentionally simple and auditable: quality 30%, detector
confidence 20%, novelty 25%, context 15%, severity 10%. These weights and the
near-duplicate threshold are starting hypotheses. The corpus calibration pass
must adjust them based on reviewed output.

## UI and MCP Behavior

The default findings workflow now makes the evidence hierarchy visible:

1. `Importance` is the default, with `Newest` and `Severity` alternatives.
2. Each analyzed row shows importance, quality, the leading explanation, and
   the number of similar rows.
3. The detail view has an evidence-ranking section and keeps severity separate.
4. Duplicate groups collapse to one representative plus a similar count.
5. Semantic and exact retrieval are explicit controls.
6. Pending analysis coverage is visible rather than silently treated as zero.
7. Outlier explanations state that unusual evidence may be useful or a false
   positive and requires review.
8. On mobile, the ranking controls and evidence table precede overview cards and
   charts; desktop retains the analytics-first layout.

MCP exposes the same model. An agent can request importance-ranked findings,
receive reasons and coverage, find neighbours without a query embedding, or
inspect repetitive clusters. It does not need to infer importance from severity,
confidence, or raw cosine distance.

## Verification Completed

- API: 555 tests passed; 17 database-backed versioning/remediation e2e tests
  passed; Nest build and typecheck passed. The semantic e2e runs HNSW and forced
  exact cosine over the same 384-dimensional fixture and verifies equivalent
  top ordering, explanations, clusters, and vector-reuse reanalysis.
- CLI: 957 tests passed, 31 skipped, and 1 expected failure. Intrinsic embedding,
  OCR, content-fetch error semantics, and detector retirement are covered.
- Schemas: 81/81 examples validate; generated detector models, OpenAPI, and the
  TypeScript API client were regenerated, and the client typechecks.
- Desktop: pgvector staging and extension creation passed on the embedded
  PostgreSQL runtime; the resident query embedding process is lifecycle-managed.
- Helm: lint and rendered-manifest checks passed for embedded PostgreSQL and
  CloudNativePG modes.
- Web: changed-file lint and translation parity pass. Desktop and mobile
  Playwright captures verify that semantic mode, importance ordering, coverage,
  and evidence rows are visible without overlap. Full repository typecheck is
  still blocked only by the pre-existing Playwright 1.60/1.59 test type mismatch
  in `custom-detector-editor.spec.tsx`.

The Docker static build check parsed the changed Dockerfile and contexts but the
local Docker engine stalled resolving base-image metadata with `only one
connection allowed`; no all-in-one image was produced in this verification.

## Remaining Corpus Gate

The branch should not be called empirically complete until a fresh scan of the
first-use corpus demonstrates all of the following:

- reviewed legal references and cross-source recurrence rank near the top;
- repeated-digit credit-card and OCR artifacts are downranked despite severity;
- generic dates, Bates numbers, and boilerplate are grouped or downranked;
- every top-50 result has at least one concrete reason and coverage state;
- pgvector and fallback produce materially equivalent ordering on a controlled
  fixture;
- analyst review measures top-50 precision before and after ranking.

So the direct answer is: **yes, the plan now makes "rank and explain better"
clear in both UI and MCP and addresses the first-use failure structurally; no,
the original corpus has not yet proved that the initial weights and thresholds
produce the right top 50.**
