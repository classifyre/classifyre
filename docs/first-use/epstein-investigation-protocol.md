# Classifyre First-Use Investigation Protocol: Epstein Corpus

Started: 2026-07-14 18:02 CEST

Environment: production Classifyre API/MCP at `127.0.0.1:58495`; repository is read-only reference unless a product fix is explicitly implemented

Operator: Codex via Classifyre MCP, with the documented HTTP API as fallback

## Purpose

Exercise an empty Classifyre instance as a real investigation platform, beginning with a bounded exploratory ingestion and progressing through extraction, classification, fingerprints/correlation, inquiries, cases, hypotheses, thread support, and timelines. This document is the durable evidence ledger for what worked, what failed, which workaround was used, and what remains unproven.

## Evidence and status vocabulary

- **PASS** — observed working through the production MCP/API and verified from returned state.
- **FAIL** — invoked with a valid in-scope request and received an error or incorrect result.
- **GAP** — required capability is absent, misleading, or cannot express the needed operation.
- **WORKAROUND** — another supported interface unblocked the scenario; the original gap remains.
- **OPEN** — hypothesis or capability not yet tested with sufficient evidence.
- **RISK** — code/config evidence suggests a failure mode, but runtime evidence is not yet conclusive.

Every production-changing action records the interface, input intent, returned ID/state, and follow-up verification. Claims about the corpus come from the local files; claims about platform behavior come from production responses or run logs.

## Baseline

### Production instance

Observed at 2026-07-14 18:02 CEST:

| Object | Count/state | Evidence |
| --- | ---: | --- |
| Sources | 7, all `LOCAL_FOLDER`, all `PENDING`, no prior runs | MCP `search_sources` and `get_source` |
| Source connection tests | 7/7 `SUCCESS` | MCP `test_source_connection` |
| Assets | 0 | MCP `search_assets` |
| Findings | 0 | MCP `search_findings` and discovery totals |
| Runs | 0 | MCP `search_runs` |
| Custom detectors | 0 | MCP `list_custom_detectors` |
| Inquiries | 0 | MCP `list_inquiries` |
| Cases | 0 | MCP `search_cases` |
| Autopilot | configured; 0 runs; system brief version 0 with empty content | HTTP `GET /autopilot/stats` and `/autopilot/system-brief` |

The seven configured sources point to DataSets 1–6 and 12. DataSet 7 exists locally but has no production source.

### Local corpus

The local corpus is 3.1 GiB and contains 4,254 files:

| Dataset | Files | Size | Production source |
| --- | ---: | ---: | --- |
| 1 | 3,144 | 1.2 GiB | yes |
| 2 | 577 | 633 MiB | yes |
| 3 | 69 | 600 MiB | yes |
| 4 | 154 | 359 MiB | yes |
| 5 | 122 | 62 MiB | yes |
| 6 | 15 | 53 MiB | yes |
| 7 | 19 | 98 MiB | **no** |
| 12 | 154 | 120 MiB | yes |

File types: 4,237 PDF, 8 Concordance `.DAT`, 8 Opticon `.OPT`, and 1 AVI. Forty-two files exceed the configured 10 MiB `max_file_bytes` default.

Direct text-layer sampling shows materially different collections:

- DataSets 1, 2, and 5 are mostly single-page photographic/scanned records with sparse native text and will stress OCR.
- DataSets 3 and 4 mix FBI/interview/evidence materials and longer documents.
- DataSet 6 contains 13 rich multi-page PDFs including grand-jury transcripts and charging documents; it is the best small first investigation slice.
- DataSet 7 contains testimony/court material but is not configured as a production source.
- DataSet 12 contains email and DOJ correspondence.

The supplied background note describes a much larger public archive; it is contextual guidance, not evidence about this 3.1 GiB local subset.

## MCP capability map

The connected Classifyre MCP exposes 71 tools. It covers:

- source discovery/configuration/validation/connection tests/runs;
- run logs and stopping;
- asset and finding search/detail/update;
- custom detector creation, validation, tests, training, and extraction coverage;
- inquiries and live matcher previews;
- cases, evidence, findings, hypotheses/discussion threads, support links, graphs, and timelines;
- correlation configuration, exclusions, occurrences, and recomputation.

Not exposed through MCP but present in the documented HTTP API:

- autopilot status, agents, runs, activity, memory, usage, tools, and system brief;
- instance settings and MCP administration;
- general graph pivot/expand/manual-edge operations;
- sandbox detector runs and several exports/charts.

The HTTP API is therefore an accepted fallback, but each fallback is recorded as an MCP coverage gap.

## Strategy decisions

### D-001 — bounded first run

Start with DataSet 6, PDF-only, using `RANDOM` with `rows_per_page: 10`. Repository inspection confirms that local-folder sampling does honor `rows_per_page`, despite the source schema describing it as tabular-only. Raise `max_file_bytes` to 100 MiB so the two PDFs larger than 10 MiB are not passed to PDF extraction as truncated byte streams.

After detector/runtime behavior is verified, switch to `AUTOMATIC` for progressive non-repeating coverage. `RANDOM` uses a fixed seed in the current implementation and repeats the same sample on subsequent runs.

### D-002 — first detector set

Use a small interpretable set before any broad Hugging Face pipeline:

1. GLiNER2 entity + document-type detector for people, organizations, locations, dates, case numbers, aircraft identifiers, financial identifiers, and legal/evidence document type.
2. REGEX detector for Bates numbers, federal dockets, investigation references, aircraft tail numbers, and emails.
3. Built-in PII detector on the source, with results evaluated for investigative usefulness and noise.

Defer general sentiment, toxicity, and generic ImageNet labels: they do not answer an initial investigative question. Evaluate a lightweight Hugging Face feature-extraction or domain classifier only after extracted text shape and fingerprint behavior are visible.

## Observation and gap ledger

| ID | Status | Observation | Evidence / impact | Workaround / next verification |
| --- | --- | --- | --- | --- |
| O-001 | PASS | Classifyre MCP is reachable and production state can be read. | Source types and all baseline searches returned structured responses. | Continue through MCP first. |
| O-002 | PASS | All seven configured local-folder sources are reachable. | Seven `test_source_connection` responses were `SUCCESS`; exact counts were returned below 100 and `100+` otherwise. | None. |
| O-003 | OPEN | Initial `search_sources` returned zero, followed later by seven newly-created sources. | Source timestamps show creation after the first check; this is state evolution, not yet a product defect. | Treat later state as authoritative. |
| G-001 | FAIL | `validate_detector_config` rejects valid bare GLiNER2 and REGEX pipeline schemas with `data must match exactly one schema in oneOf`. | Repository code passes a bare pipeline schema to `validateDetectorConfig`, whose root schema expects an outer detector config. | Validate locally against `#/definitions/AnyPipelineSchema`; detector creation remains available. |
| G-002 | GAP | Local-folder sampling schema says `rows_per_page` is tabular-only, while runtime uses it to bound `AUTOMATIC`, `RANDOM`, and `LATEST`. | Schema/tool guidance can cause agents to believe local exploration cannot be bounded. | Use the confirmed implementation behavior; recommend schema wording fix. |
| G-003 | RISK | Local-folder `RANDOM` sampling is seeded with `0` on every run. | Re-running RANDOM selects the same objects, so it does not provide ongoing broad exploration. | Use one reproducible exploratory run, then `AUTOMATIC`. |
| G-004 | RISK | Files larger than `max_file_bytes` are truncated before PDF parsing. | Forty-two corpus files exceed 10 MiB; truncated PDFs may lack an EOF/xref and fail native extraction/OCR. | Use 100 MiB for this corpus and verify run logs for extraction errors. |
| G-005 | GAP | MCP has no autopilot/system-brief tools although these capabilities exist in the API. | The first-use agent cannot inspect or update the living brief through MCP alone. | HTTP fallback used; record all reads/writes. |
| G-006 | OPEN | Source search totals report `running: 7` while all sources are `PENDING` with no runner. | Potential summary-label/counting inconsistency. | Recheck after first run and inspect implementation before classifying as FAIL. |
| G-007 | OPEN | DataSet 7 exists locally but is not represented by a production source. | Coverage is incomplete relative to the local corpus. | Decide after first-run validation whether to create it. |
| G-008 | FAIL | GLiNER2 entity + classification pipelines return no findings with production `gliner2==1.3.2`. | Runtime exposes `classify_text`, but Classifyre calls nonexistent `model.classify`; the shared exception handler then discards entities extracted earlier in the same run. Warmed retest: 0/2 PASS in 57.8 s. | Split to entity-only pipeline: version 3 passed 1/1 in 20.3 s with five correct findings. Document classification remains broken. |
| G-009 | GAP | `run_detector_tests` can exceed the MCP client's 300-second limit even though the server persists later per-scenario results. | The MCP returned only a timeout; results had to be recovered via `list_detector_test_scenarios`. | Use the HTTP run endpoint for a bounded retest and then read persisted scenarios. |
| G-010 | GAP | MCP can create and list detector test scenarios but cannot delete one, although the API supports deletion. | The obsolete classification scenario had to be removed before an entity-only retest. | HTTP `DELETE /custom-detectors/{detectorId}/test-scenarios/{scenarioId}` returned 204. |
| G-011 | FAIL + WORKAROUND | PII failed on every text page when configured with valid `chunk_size` and `chunk_overlap` values. | Generated config represents both as `RootModel[int]`, while `_chunk_text` subtracts the wrapper objects: `unsupported operand type(s) for -: 'ChunkSize' and 'ChunkOverlap'`. The run still ended `COMPLETED`, “10 processed, 0 errors.” | Removing both optional fields works: retry runner `e2c5029e-4e56-4109-afef-2725a901719f` completed 10/10 assets with 136 successful PII page invocations and no runtime errors. |
| G-012 | FAIL | First-run asset lifecycle counters/statuses are incorrect. | Ten assets have first-run `createdAt` timestamps, but the runner reports `assetsCreated: 0`, `assetsUnchanged: 10`, and every new asset is stored as `UNCHANGED`. | Data persisted, so investigation is unblocked; counter/status semantics need a product fix. |
| G-013 | GAP | MCP exposes run summary/logs but not the read-only per-run asset progress available in HTTP API. | During execution the API returned `6 processing / 4 pending / 10 total`. | HTTP `GET /runners/{runnerId}/assets/progress` fallback. |
| G-014 | GAP | Run status can be `COMPLETED` with pervasive detector failures and zero surfaced runner errors. | PII failed on every page, but `errorMessage` was null and phase summary said `0 errors`. An operator who does not inspect 1,209 log rows would believe PII succeeded. | Inspect detector-specific finding counts and error logs after every run; recommend `WARNING` status/failed-detector counters. |
| O-004 | PASS | Reprocessing the same deterministic sample is finding-idempotent. | Persisted total moved from 439 REGEX-only findings to 1,816 total, not 2,255: the same 439 REGEX findings retained their IDs/`firstDetectedAt` and received a new `lastDetectedAt`; 1,377 PII findings were added. | Treat `runner.totalFindings` as the post-run persisted set for processed assets, not newly-created finding count. |
| O-005 | PASS | Native PDF text extraction works on the bounded DataSet 6 sample, including the 13.56 MiB file. | Ten PDFs produced 136 text pages and findings; logs explicitly report native text-layer extraction. | OCR quality on image-only datasets remains untested. |
| O-006 | RISK | Generic PII NER is useful for recurrence but noisy on numbered grand-jury transcript lines. | 1,377 persisted PII findings: 879 dates, 312 persons, 186 locations. Useful values include Jeffrey Epstein, Ghislaine Maxwell, Palm Beach, 9 East 71st Street, Teterboro, and New Mexico; false spans include `24 Q.`, `4 A. Epstein`, `MOBILE`, and line numbers parsed as dates. | Use exact-value/recurrence evidence selectively; do not create a broad PII inquiry. Compare GLiNER2 entity quality on one rich document. |
| O-007 | PASS | Deterministic legal references connect multiple sampled documents. | `2018R01618` occurs in five PDFs; docket `15-CV-7433`/`15-cv-07433-RWS` occurs in three findings across three PDFs. | Use these eight findings for the first inquiry and case. |
| G-015 | FAIL | The aircraft regex is too permissive for OCR/transcript text. | Four hits include one plausible identifier (`N90656`) and three short false positives (`N3`, `N4`, `N10`). | Exclude aircraft findings from the first inquiry; tighten or remove the pattern before broader runs. |
| G-016 | NOT REPRODUCED (closed 2026-07-16) | Correlation inflates shared-value counts and can create false duplicate links with impossible scores over 100%. | First REGEX-only autopilot run reported 3,808 shared Bates numbers and a 45.46/4,546% match between two PDFs although only 427 Bates findings exist globally. The retry still reported 128 shared Bates values and 135%. Each finding carries the page's complete `pipeline_result.entities`; correlation appears to re-index those page entities once per emitted finding. | **The stated cause is wrong and the symptom does not reproduce on this build.** `rebuildAssetValues` selects five scalar columns and never reads `metadata`, so the embedded `pipeline_result` is not an input to scoring; it dedupes by `valueHash`, and `asset_correlation_values` carries `@@unique([assetId, valueHash])`, so a value cannot be indexed twice for one asset. `scorePair` is weighted Dice — 2·shared/(totalA+totalB) — whose numerator is a subset sum of its denominator's terms; `stagePairAggregates` and `loadAssetTotals` apply the same scope and the same `owners <= FANOUT_CAP` filter, so the streamed path is bounded identically. Bounds pinned by `apps/api/src/correlation/g016-score-bounds.spec.ts` (a score > 1 fails the suite). **Verified at the SQL level** against PostgreSQL 16: the real `stagePairAggregates` numerator and `loadAssetTotals` denominator, run over two assets sharing 427 Bates numbers, return `sharedCount = 427` (not 3,808) and `weighted = 0.8952` (not 45.46). **The reported symptom was then reproduced by removing the dedup**: dropping `unique(assetId, valueHash)` and indexing each value ~9× — precisely what "re-index a page's entities once per emitted finding" does — yields `sharedCount = 34,587` and `weighted = 8.88` (888%), matching the report's shape. So the hypothesis was mechanically right about the class of bug, and this build already prevents it; the run used a pre-fix build (the last correlation change predates it by ~3 weeks). Reopen with a runnable repro if it recurs. The separate, confirmed defect the hypothesis pointed at is storage amplification, tracked below. |
| G-016b | FAIL (partly fixed) | Each finding stores a copy of its page's whole entity dump — 240× amplification, measured. | `_base.py` attaches `_slim_pipeline_result` (≤25 spans/label) to every finding on a page, and the API persisted it twice: in `findings.metadata` JSONB *and* `custom_detector_extractions.pipeline_result`. A realistic 8-label page emitting 240 entity findings stores 3.2 MB where 13.7 KB would do. | The `findings.metadata` copy is removed (PR #195): `asset.service.ts` now filters `pipeline_result` alongside `embedding`, halving the cost. The per-finding extraction row remains, because `CustomDetectorExtraction.findingId` is `@unique`. Its only consumer is `recent_pipeline_result` in `mcp-server.factory.ts`, which reads a **single** sample — so 240 copies exist to serve one. Fixing it is a data-contract decision (store per-page, or narrow each finding's dump to its own span), not a bug fix; open. |
| O-008 | PASS | Targeted synchronous correlation recompute returns interpretable related-document evidence. | Recomputing `EFTA00008744.pdf` indexed 430 values and found two related pairs, no duplicates; top match to `EFTA00008631.pdf` scored 0.33 with 84 dates, 26 locations, 14 persons, and one investigation reference shared. | Useful as an exploratory lead, but the noisy PII values and G-016 prevent treating the score as proof. |
| G-017 | GAP | Correlation graph is available only through HTTP, not MCP. | HTTP `/correlation/graph` returned 258 nodes and 618 inferred edges for DataSet 6; MCP exposes config, occurrences, exclusions, and recompute only. | HTTP read fallback used. |
| G-018 | FAIL | Autopilot inquiry memory can race with a subsequent scan and persist a false source profile. | The inquiry agent for baseline runner `07fb...` started while retry runner `e2c...` was replacing/reconciling findings, then wrote “no findings / likely requires OCR” after the instance already held 1,816 findings and native extraction was proven. | Treat autopilot memory as untrusted until refreshed; update the system brief with verified facts and avoid using this memory as case evidence. |
| O-009 | PASS + RISK | Entity-only GLiNER2 works in a real ingestion run and is materially better than generic PII for names and legal entities, but broad special-purpose labels still hallucinate. | Exact-prefix run on `EFTA00008998.pdf` produced 45 GLiNER findings in 56.8 s: useful examples include Audrey Strauss, Ghislaine Maxwell, Jeffrey Epstein, Minor Victim labels, Palm Beach, London, dates, organizations, and `15 Civ. 7433`. It also labeled Bates/production-number composites as case, aircraft, and financial identifiers, sometimes at 0.99 confidence. | Keep person/location/date/organization/case entities as investigative leads requiring source review; remove aircraft/financial entity labels before broader deployment or mark their output untrusted. |
| G-019 | FAIL | Narrowing an existing source's prefix and using `ALL` retires previously ingested assets outside the new scope. | The one-document GLiNER run processed one unchanged asset but reported `assetsDeleted: 9`; the active inquiry fell from 8 matches to 0 immediately even though the case retained its already-pulled evidence. | Do not reuse a populated source for one-file experiments. Use a separate temporary source or a sandbox endpoint. Full PDF scope was restored immediately and a 13-PDF remediation run started. |
| G-020 | GAP | A runner's `totalFindings` is not a count of findings emitted or created by that run. | The one-asset GLiNER run reported 1,858 total findings while it emitted 45 GLiNER findings; the number is the current persisted open set after reconciliation. | Rename/document the metric or expose created/updated/retained finding counters. |
| O-010 | PASS | Inquiry, case evidence pull, hypothesis/discussion threads, support links, graph, and timeline work end-to-end. | Inquiry preview/create matched 8 exact legal-reference findings; pull created 6 asset evidence rows and 8 case-finding rows. A supported hypothesis has five distinct supporting finding links; the case timeline has 10 events and its depth-2 graph has 208 nodes/205 edges. | Reverify inquiry matches after G-019 remediation; correlation edges in the graph remain subject to G-016. |
| O-011 | PASS | Full DataSet 6 PDF remediation/expansion completed without extraction errors. | Runner `d2095771-5497-4ffb-a13a-d2c08361eb3b` processed all 13 PDFs in 249,384 ms, including three previously unseen PDFs; `assetsDeleted: 0`, 13 active assets, 0 per-asset errors. The run produced 3,239 current-run finding records/candidates across PII, REGEX, and GLiNER2. | Final config changed to `AUTOMATIC` sample size 10, full PDF scope, 100 MiB max, schedule disabled. |
| G-021 | FAIL | Adding a second custom detector to previously-scanned unchanged assets auto-resolves still-present findings from the original custom detector and built-in PII. | In the full run, the nine previously scanned assets retained only new GLiNER findings as `OPEN`; their earlier PII/REGEX findings became `RESOLVED`. The three newly seen PDFs and the one PDF first run with both custom detectors retained all detector families. All eight exact legal references were wrongly resolved and the inquiry fell to zero. | Manually reopened only the eight source-verified legal-reference findings; `rematch_inquiry` landed 8 and restored the active inquiry. Bulk noisy output remains resolved rather than being blindly reopened. Product reconciliation must be keyed by detector identity/version, not an aggregate custom-detector set. |
| G-022 | GAP | GLiNER entity findings report 0% extraction coverage. | `get_extraction_coverage` returned 1,140 total GLiNER findings, 0 with extraction, coverage rate 0. GLiNER stores entities as ordinary findings and repeated `pipeline_result` metadata rather than `extracted_data`. | Use finding search for GLiNER output; extraction coverage is not meaningful for this otherwise successful entity detector. |
| O-012 | PASS + DECISION | MiniLM feature extraction works for plain text but is not useful to the current investigation graph. | Inactive sandbox-only detector `9d7cb87f-bbd7-4071-9480-22fe2bca16c7` produced one normalized 384-dimensional `all-MiniLM-L6-v2` embedding from a 193-character text in 15,461 ms. | Keep inactive/unattached. Repository correlation explicitly says “No AI, no embeddings,” so embedding findings currently require an external vector consumer and do not improve Classifyre fingerprints. Generic sentiment/spam/toxicity classifiers are not investigation-aligned. |
| G-023 | FAIL | The same Feature Extraction detector returned zero findings for a direct PDF sandbox upload. | PDF sandbox runner `5c2401c0-2373-4e2c-a4ae-df2661a0fd3b` completed in 19,959 ms with no error and zero findings, while a text upload succeeded. | Extract text before this detector in sandbox or fix sandbox content-type/text-page routing for transformer text runners. Do not attach based on the plain-text smoke test alone. |
| G-024 | GAP | Sandbox create/get responses inline uploaded file bytes as a JSON integer-key object. | Creating the 3.2 MiB PDF sandbox run attempted to return a roughly 10.6-million-token response and was truncated. | Omit `inputData` from normal run DTOs; expose it only from the dedicated input endpoint. Filter with `jq del(.inputData)` when using HTTP fallback. |
| G-025 | FAIL | Autopilot repeated the same false no-findings/OCR memory through a second agent kind and reported misleading work counts. | The CASE run for the baseline scan wrote another source profile claiming zero findings at 18:29, while the full run was actively reconciling thousands. It took 773,272 ms, ended with summary “8 applied,” but `decisionCount` was 1 and the activity feed shows only the single memory write. | The verified system brief explicitly invalidates both memories. Do not allow scan agents to reason over a source while another runner is reconciling it; align summary/action counters. |
| O-013 | PASS | The living system brief can be corrected through the HTTP API. | `PUT /autopilot/system-brief` created version 2 with verified source, detector, inquiry, case, correlation, reconciliation, final-config, and transformer-smoke facts; server-derived facts reported 13 assets, 1,494 open findings, one active inquiry, one open case, and two active custom detectors (the MiniLM smoke detector is inactive). | MCP coverage remains G-005. |
| G-026 | FAIL | The autopilot CONFIG agent interprets zero delta counters or a broken scoped asset profile as an empty source, even when authoritative state contradicts that conclusion. | CONFIG run `a57ef1f4-b847-4fa7-afef-5b6742e427db` reviewed the old baseline runner, received zero from `assets.profile`/`assets.sample`, ignored system brief version 2 and the completed full run's 13 unchanged assets/3,239 findings, wrote a third false “0 assets and 0 findings” memory, and triggered runner `763ffa52-b626-4e25-b8a5-d39f6f395256`. The unnecessary run completed 10 unchanged sampled PDFs with 2,656 associated findings and zero errors. The CONFIG run then reported “11 applied” although it contains only two decisions. | Asset-profile tools must distinguish runner scope from source scope, and agents must use total/unchanged counters plus current source state before mutating. Keep all three false memories out of evidence and refresh the system brief after the agent is terminal. |
| G-027 | FAIL + WORKAROUND | Scan-cycle autopilot reviews can drain old scan events long after newer source state supersedes them. | After the 833-second CONFIG review of baseline runner `07fb...` finally ended, Classifyre launched DETECTOR_AUTHOR and ESCALATION reviews for that same old runner, then began a new INQUIRY review for retry runner `e2c...`. ESCALATION reported “4 applied” with zero decisions. This stale backlog had already produced G-018/G-025/G-026 and could continue mutating current state from obsolete context. | Disabled INQUIRY, CASE, CONFIG, DETECTOR_AUTHOR, and ESCALATION scan-cycle agents. The already-instantiated `e2c...` cycle still had to drain/cancel separately. Re-enable only after snapshot scoping, queue freshness, and summary accounting are fixed. |
| G-028 | GAP | The deterministic DUPLICATES scan-cycle worker appears in run statistics but is absent from configurable agents and cannot be disabled. | `PATCH /autopilot/agents/DUPLICATES` returns HTTP 400 `Unknown agent`; `/autopilot/agents` lists only INQUIRY, CASE, CONFIG, DETECTOR_AUTHOR, ESCALATION, and non-enableable DREAM. | Future scans may still run correlation even while all configurable scan agents are paused. Add an enable toggle or document the worker as mandatory; continue treating its links as leads only because of G-016. |
| G-029 | FAIL + WORKAROUND | Disabling scan-cycle agents does not purge an already-instantiated cycle, and cancellation is not reliably terminal. | After all five configurable agents were disabled, the `e2c...` cycle still launched CASE, CONFIG, DETECTOR_AUTHOR, and ESCALATION sequentially. INQUIRY run `66ccd00f-804b-46c1-8259-8bc002f2f96b` first returned `CANCELLED`, then finalized as `COMPLETED` with `error: Cancelled by the operator`, zero decisions, and a false “5 applied” summary. CASE also reported five applied with zero decisions. | Repeatedly cancel each newly-started member of an existing cycle, then observe a quiet window. CONFIG, DETECTOR_AUTHOR, and ESCALATION were cancelled with zero decisions; a 30-second post-cycle check held at zero active runs. Make cancellation terminal and add a queue-purge control. |
| O-014 | PASS | Production was stabilized and the operator brief refreshed after the initial autopilot evaluation. | Autopilot reported `activeRuns: 0` after the quiet-window check; five configurable scan-cycle agents were disabled, no cancelled backlog member made a decision, and system brief version 4 reported 13 assets, 1,589 open findings, one active inquiry, one open case, and two active custom detectors. | Historical checkpoint; superseded by the full-corpus brief v6. DREAM remains non-enableable and DUPLICATES remains subject to G-028. |
| O-015 | PASS | A uniform full-corpus `ALL` scan completed for every configured source. | Seven terminal runners processed 4,235 unchanged active assets with zero per-asset errors, zero deletes, and 68,617 runner-associated findings: DS1 3,144/6,958; DS2 577/1,420; DS3 69/4,057; DS4 154/34,487; DS5 122/510; DS6 15/2,967; DS12 154/18,218. All sources retain `ALL`, 100 rows/page, 100 MiB max, PII, both custom detectors, disabled schedules, and no current runner. | Treat runner finding totals as run-associated state rather than newly-created findings (G-020); use the live 68,987-record finding store for handoff counts. |
| G-030 | GAP | Empty OCR output is not represented in per-asset error counts or terminal status. | RapidOCR logged empty-result warnings on otherwise successful runs: DS1 409, DS2 297, DS3 8, DS5 1, DS4 1, DS12 2, DS6 0. All runners still reported zero asset errors. | Record empty OCR as missing-text coverage and inspect sparse/image-only pages separately; DREAM persisted this as a durable precedent. |
| G-031 | GAP | Runner log severity is noisy enough to undermine automated health interpretation. | Informational model-load progress, a transformer model-type compatibility line, and macOS AV/OpenCV duplicate-class warnings are recorded as `ERROR`; unauthenticated Hugging Face notices are `WARN`. None prevented terminal completion or findings. | Use terminal state plus asset progress, detector counts, and specific exception text; do not equate the raw `ERROR` log count with failed assets. |
| G-032 | FAIL | Autopilot run summaries count read/tool steps as “applied” even when no decision or mutation exists. | Manual CASE, DETECTOR_AUTHOR, and ESCALATION runs reported 11, 2, and 4 applied respectively while each persisted `decisionCount: 0`; direct source, detector, inquiry, and case checks found no mutation. DREAM reported 10 applied for six recorded mutations. | Use persisted decisions and direct state verification as authoritative; summary accounting must separate reads, reasoning steps, and applied mutations. |
| G-033 | FAIL | Inquiry `newMatchCount` is stale and contradicts its actual match endpoint. | Inquiry `7699...` reports `matchCount: 8`, `newMatchCount: 15`, while `/matches` returns exactly 8 total and 0 new. The CASE agent spent time trying to explain the impossible count. | Use `/inquiries/{id}/matches` for actual totals; recompute/reset the denormalized counter after rematch/reconciliation. |
| G-034 | RISK | Severity alone overstates evidence quality in the full corpus. | All six `CRITICAL` findings are built-in `CREDIT_CARD` recognizer matches. The values include repeated 15-digit strings and obvious repeated-digit/OCR-like patterns; none was source-reviewed as a payment card. The escalation agent correctly declined to alert on the existing medium case. | Source-review critical PII before case creation or escalation; a recognizer label is not proof of identity, account type, or wrongdoing. |
| G-035 | FAIL | The CASE agent confused a detector catalog version with its stable key and therefore queried a nonexistent key. | It searched `epstein_investigation_entities_v4`, received no findings, and abandoned entity review. The real key is `epstein_investigation_entities_v1`; catalog version is 4, with 20,957 live entity-type records across all statuses. | Agent tools/prompts should expose detector ID, stable key, and version as distinct fields and resolve names through `detectors.list` before searching. |
| O-016 | PASS | The deliberate full-corpus autopilot review and DREAM consolidation reached a clean terminal state. | INQUIRY, CASE, CONFIG, DETECTOR_AUTHOR, and ESCALATION completed with zero decisions and no production mutation; DREAM made six intended decisions: delete three stale memories, write two evidence-handling precedents, and publish brief v6. Final state: 28 autopilot runs, 0 active, two current memories, five configurable agents paused, DREAM enabled/non-enableable. | Manual cycle is complete. Keep scan-cycle agents paused until G-027/G-029/G-032 are fixed. |
| O-017 | PASS + RISK | Full-corpus exact-value analysis produced one new cross-source PII lead without overclaiming it. | The exact phone value ending `3363` occurs once in DS4 `EFTA00008008.pdf` and once in DS12 `EFTA02730274.pdf`; reverse-index lookup confirms two distinct assets/sources. Exact organization recurrences also connect collections, but many are generic institutions or OCR fragments. | Retain as an unverified lead only; review document context before creating an inquiry or case. Exact recurrence proves shared text, not person identity or relationship. |

## Full-corpus terminal snapshot

Observed after the final AI quiet window at 2026-07-14 21:26 CEST:

| Dataset | Active assets | Full-run findings | Live findings | Open | Resolved | False positive | Empty OCR warnings |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 3,144 | 6,958 | 6,958 | 6,958 | 0 | 0 | 409 |
| 2 | 577 | 1,420 | 1,420 | 1,420 | 0 | 0 | 297 |
| 3 | 69 | 4,057 | 4,057 | 4,057 | 0 | 0 | 8 |
| 4 | 154 | 34,487 | 34,487 | 34,487 | 0 | 0 | 1 |
| 5 | 122 | 510 | 510 | 510 | 0 | 0 | 1 |
| 6 | 15 | 2,967 | 3,337 | 1,592 | 1,742 | 3 | 0 |
| 12 | 154 | 18,218 | 18,218 | 18,218 | 0 | 0 | 2 |
| **Total** | **4,235** | **68,617** | **68,987** | **67,242** | **1,742** | **3** | **718** |

The DS6 live/run difference is expected from earlier reconciliation history: runner totals are not “new findings” counters (G-020), while the live store retains resolved and false-positive records. Live severity totals are 6 critical, 10,300 high, 49,732 medium, 18 low, and 8,931 info. Detector-family totals are 39,069 PII and 29,918 custom.

Every source independently reverified as `COMPLETED`/`ALL`, PII enabled, both custom detector IDs attached, schedule disabled, and `currentRunnerId: null`. Both custom detectors remain active at their intended versions: `epstein_investigation_identifiers_v1` catalog v2 and `epstein_investigation_entities_v1` catalog v4.

| AI review | Run | Duration | Recorded decisions | Verified outcome |
| --- | --- | ---: | ---: | --- |
| INQUIRY | `70ec667b...` | 12,529 ms | 0 | No inquiry change |
| CASE | `f140fa56...` | 154,694 ms | 0 | Existing case/inquiry read; no enrichment |
| CONFIG | `4928f62c...` | 97,153 ms | 0 | Honored no-retune/no-rescan instruction |
| DETECTOR_AUTHOR | `0e05ef1c...` | 611,778 ms | 0 | Honored no-authoring instruction; catalog unchanged |
| ESCALATION | `38b7c42b...` | 290,035 ms | 0 | Medium case did not justify notification |
| DREAM | `251e3c59...` | 341,348 ms | 6 | Three stale memories deleted, two precedents written, brief v6 published |

For the five review agents, the persisted decision count and direct state diff agree: there was no mutation. Their “applied” summary strings do not agree and are tracked as G-032.

## Production action ledger

| Time (CEST) | Action | Interface | Result | Verification |
| --- | --- | --- | --- | --- |
| 18:02 | Read baseline state and system brief | MCP + HTTP GET fallback | 7 pending sources; otherwise empty instance; brief v0 | Cross-checked sources, assets, findings, runs, detectors, inquiries, cases |
| 18:02–18:03 | Test all source connections | MCP | 7/7 success | Returned source-specific object counts |
| 18:07 | Create identifier detector | MCP | `47763325-c4df-434d-946e-5df8c8b3327f` | Repository `AnyPipelineSchema` validation; production tests 2/2 PASS |
| 18:07 | Create GLiNER2 entity/document detector | MCP | `c4b79ced-bb42-4192-8370-99c8bf6a2d0f` | Repository schema valid; first production tests ERROR/FAIL |
| 18:13 | Lower GLiNER2 confidence 0.68 → 0.50 | MCP | Detector version 2 | Warmed-cache HTTP retest in progress; detector remains unattached |
| 18:14 | Configure bounded DataSet 6 slice | MCP validate + update | Valid; PDF-only, RANDOM 10, 100 MiB max, built-in PII + identifier detector | `update_source` returned normalized persisted config; run not started yet |
| 18:16 | Split broken GLiNER2 combined pipeline to entity-only | MCP + HTTP DELETE fallback | Detector version 3; obsolete classification scenario removed | Entity test 1/1 PASS; five correct findings in 20,254 ms |
| 18:17 | Start bounded DataSet 6 baseline run | MCP | Runner `07fb324a-ce8a-41fc-9c5d-060ed306427f` | Entered `RUNNING`; recipe valid; worker pool effective size 3 |
| 18:19 | Baseline run completed | MCP + HTTP progress fallback | 10 assets persisted; 439 REGEX findings; 78,541 ms | PII produced 0 and failed on every page; lifecycle counters wrong |
| 18:20 | Remove PII chunk wrapper fields and retry | MCP validate + update + run | Config valid; runner `e2c5029e-4e56-4109-afef-2725a901719f` | Completed in 54,618 ms; 10/10 assets, 1,816 persisted findings, zero page/runtime errors |
| 18:21 | Audit retry findings and repeat-run identity | MCP discovery/search/options + logs | 1,377 PII + unchanged 439 REGEX; prior deterministic IDs retained | Confirmed idempotency, useful recurring values, transcript NER noise, and aircraft-pattern false positives |
| 18:23–18:24 | Inspect/recompute evidence fingerprints and autopilot | MCP + HTTP GET fallback | Exact reference recurrence works; correlation graph 258 nodes/618 edges; autopilot 3 runs/5 actions | Found false >100% duplicate scores and stale “no findings” memory race; system brief facts nevertheless show 1,816 open findings |
| 18:24 | Configure one-document GLiNER2 production run | MCP validate + update + run | Valid exact-prefix `EFTA00008998.pdf`, 100-line pages, PII + REGEX + GLiNER2; runner `4ba83fac-df5d-49d6-a5fd-2084ce4bfc66` | Completed in 56,841 ms with 45 GLiNER findings; unexpectedly retired nine out-of-prefix assets (G-019) |
| 18:25 | Review aircraft hits | MCP bulk finding update | `N3`, `N4`, `N10` marked `FALSE_POSITIVE`; `N90656` left open | Three updates persisted with review comment |
| 18:25 | Create exact-reference inquiry | MCP preview + create | Inquiry `7699aed4-c4b1-4c4e-8eb3-d1967d23f4b5`; 8 initial matches | Five `2018R01618` and three docket findings; noisy types excluded |
| 18:25 | Create and populate first case | MCP case + pull + threads + support | Case `a4e2e9ef-e03d-413e-b5ee-9cbfc73b8285`; 6 assets/8 findings; hypothesis `d061016f-bf50-4c9e-b1e7-fe455f6c3678`; discussion `d83abfc2-f4a0-4f81-a708-98809c0ece6b` | Five exact findings support the hypothesis; graph and 10-event timeline verified |
| 18:25 | Targeted GLiNER2 run completed | MCP | 1 PDF, 45 GLiNER findings, 56,841 ms; **9 out-of-prefix assets retired** | Captured useful/noisy entity examples; identified scope lifecycle defect G-019 |
| 18:26 | Restore full DataSet 6 PDF scope and expand safely | MCP validate + update + run | Full scope, `ALL`, 100-line pages, all three working detector paths; runner `d2095771-5497-4ffb-a13a-d2c08361eb3b` | Completed 13/13 with no extraction errors; remediation restored active assets but exposed G-021 |
| 18:30 | Full DataSet 6 run completed | MCP + HTTP progress fallback | 13/13 PDFs, 0 errors, 3,239 run findings, 249,384 ms; no assets deleted | All 13 active; revealed cross-detector reconciliation bug G-021 |
| 18:33 | Restore exact-reference inquiry state | MCP bulk update + rematch | Eight verified findings reopened; rematch landed 8 | Inquiry again reports 8 matches; case evidence/support remained intact |
| 18:33–18:35 | Refine detectors and final source defaults | MCP | Identifier v2 removes aircraft pattern; GLiNER v4 removes aircraft/financial labels, raises threshold to 0.65, tightens descriptions; final source `AUTOMATIC` 10 | GLiNER v4 saved scenario PASS (5 correct entities); schedule remains disabled |
| 18:35 | Correct living system brief | HTTP PUT fallback | System brief version 1 | Server facts: 13 assets, 1,494 open findings, 1 inquiry, 1 case; both stale autopilot memories explicitly invalidated |
| 18:36–18:38 | Evaluate Hugging Face MiniLM feature extraction | MCP detector + HTTP sandbox fallback | Plain text PASS: normalized 384-d embedding in 15,461 ms; PDF FAIL: completed with zero findings | Detector `9d7cb87f-bbd7-4071-9480-22fe2bca16c7` left inactive and unattached; no current correlation consumer |
| 18:40 | Final system-brief correction | HTTP PUT fallback | System brief version 2 | Added transformer outcome; refreshed facts remain 13 assets, 1,494 open findings, 1 inquiry, 1 case |
| 18:41–18:45 | Observe autopilot CONFIG recovery rescan | HTTP autopilot inspection + MCP run monitoring | CONFIG agent misread the source as empty, wrote a third false memory, and triggered runner `763ffa52-b626-4e25-b8a5-d39f6f395256`; run completed 10/10 unchanged sampled PDFs, 2,656 associated findings, 235,007 ms, 0 errors/deletes | All 13 assets remained active; source config and disabled schedule were unchanged; inquiry stayed at 8, case stayed intact, OPEN findings became 1,589, and active GLiNER findings became 1,235 |
| 18:51–18:53 | Audit delayed autopilot backlog | HTTP GET fallback | CONFIG ended after 833,346 ms with two decisions but “11 applied”; DETECTOR_AUTHOR made no decisions; ESCALATION made no decisions but reported “4 applied”; stale INQUIRY review then started for retry runner `e2c...` | Confirmed G-026/G-027 and that old scan events can act after current state has advanced |
| 18:53 | Stabilize scan-cycle autonomy | HTTP PATCH/POST fallback | Disabled INQUIRY, CASE, CONFIG, DETECTOR_AUTHOR, ESCALATION; cancelled INQUIRY run `66ccd00f-804b-46c1-8259-8bc002f2f96b` before any decision | `activeRuns: 0`; all five enableable agents report disabled; DUPLICATES cannot be configured (G-028) |
| 18:54 | Publish authoritative handoff brief | HTTP PUT fallback | System brief version 3 | Server facts: 13 assets, 1,589 open findings, 1 inquiry, 1 case, 2 active custom detectors; narrative invalidates all three false memories and records paused agents |
| 18:54–18:58 | Drain the already-instantiated retry-scan cycle | HTTP cancel + monitoring fallback | Despite disabled agents, INQUIRY/CASE completed with zero decisions; CONFIG, DETECTOR_AUTHOR, and ESCALATION then started serially and were cancelled with zero decisions | Exposed non-terminal cancel/queued-cycle defect G-029; 30-second quiet-window check ended with 15 total autopilot runs and 0 active |
| 18:59 | Correct final handoff brief | HTTP PUT fallback | System brief version 4 | Replaced the momentary v3 stabilization claim with the complete queue-drain/cancel outcome; live server facts unchanged |
| 19:20–19:23 | Validate and apply uniform full-corpus configuration | MCP source reads/validation/update | All seven sources set to `ALL`, 100 rows/page, full file-type scope, 100 MiB max, built-in PII without chunk wrappers, identifier v2, and entity v4; schedules disabled | Seven connection tests succeeded; normalized configs reread before scanning |
| 19:23–20:52 | Run all seven configured sources | MCP run/start/monitor + HTTP progress/log fallback | Terminal runners: DS6 `2c02...` 15 assets/2,967; DS3 `13cf...` 69/4,057; DS5 `8180...` 122/510; DS12 `342d...` 154/18,218; DS2 `0e549...` 577/1,420; DS4 `bd097...` 154/34,487; DS1 `aa4f...` 3,144/6,958 | 4,235 active assets; every runner `COMPLETED`, zero per-asset errors/deletes; warning audit exposed G-030/G-031 |
| 19:28–20:53 | Observe mandatory duplicate consolidation | HTTP autopilot fallback | Seven new DUPLICATES jobs completed, two decisions each; combined current graph facts show 83 clusters | Thin evidence persists: DS1 top 100% pair shared one person value; DS2 top 100% pair shared one event date. Leads only per G-016/G-028 |
| 20:55 | Publish full-corpus operator brief | HTTP PUT fallback | System brief version 5 | Server facts: 4,235 assets, 67,242 open findings, 7 sources, 83 clusters, 1 case, 1 inquiry, 2 custom detectors |
| 20:55–21:15 | Run steered full autopilot review | HTTP POST trigger + run/log monitoring | INQUIRY `70ec...`, CASE `f140...`, CONFIG `4928...`, DETECTOR_AUTHOR `0e05...`, ESCALATION `38b7...` all completed with zero decisions | Direct state audit confirmed no scan, config, detector, inquiry, case, or alert mutation; exposed G-032/G-033/G-035 |
| 21:15–21:21 | Run DREAM memory consolidation | HTTP POST trigger + monitoring | DREAM `251e...` completed in 341,348 ms with six decisions | Deleted three stale DS6 memories, wrote duplicate/OCR precedents, published system brief v6 with correct derived facts |
| 21:22–21:26 | Restore safe autonomy posture and complete quiet audit | HTTP PATCH + GET fallback | Five configurable agents disabled; DREAM remains enabled/non-enableable | `activeRuns: 0`; no active source runners; all sources terminal/ALL; detector versions unchanged; memory count 2; inquiry/case intact |

## Capability gates

- [x] MCP connection and empty-state discovery
- [x] Source configuration can be read
- [x] Source connections succeed
- [x] Detector schemas validated via a trustworthy path
- [x] At least one custom detector created, tested, and attached
- [x] Bounded source configuration verified after update
- [x] First run completed with inspectable logs
- [x] Assets and native text extraction verified
- [x] Findings evaluated for precision and investigative value
- [x] Fingerprints/correlation observed and checked
- [x] Inquiry created from evidence-backed matcher
- [x] Case, hypothesis/discussion, support links, graph, and timeline exercised
- [x] Autopilot behavior and system brief evolution evaluated
- [x] Unsafe scan-cycle autonomy paused and zero active agent runs verified
- [x] Every configured source set to `ALL` with the validated detector set
- [x] All 4,235 configured-source files processed by terminal full-corpus runs
- [x] Full-corpus OCR/log coverage caveats audited
- [x] Deliberate five-agent review plus DREAM consolidation completed and verified
- [x] Final end-to-end gap audit completed

## Completion audit

| Requested outcome | Authoritative evidence | Result |
| --- | --- | --- |
| Read the supplied background first and understand the corpus | Background context was separated from local evidence; the local 3.1 GiB/4,254-file corpus and per-dataset characteristics were profiled before production mutation. | Complete |
| Inspect the empty instance, source configs, and MCP surface | Baseline covers all seven sources and empty object stores; capability map records all 71 MCP tools and HTTP-only gaps. | Complete |
| Start with a small, deliberate first run | DataSet 6 was selected for rich native text; first scope was reproducible RANDOM 10, PDF-only, 100 MiB max. | Complete |
| Configure detectors manually and evaluate GLiNER2, REGEX, and Hugging Face paths | REGEX v2 and GLiNER v4 are active/tested; broken GLiNER classification was isolated; MiniLM text/PDF sandbox outcomes were measured and it remains safely inactive. | Complete |
| Run slowly and inspect assets, findings, errors, counters, and lifecycle | Baseline, retry, targeted, full remediation, and autopilot scans were monitored through state/logs/progress; lifecycle, reconciliation, status, and counter defects are recorded. | Complete |
| Exercise fingerprints/correlation and a real inquiry | Exact reverse occurrence verified `2018R01618` across five PDFs; correlation defects documented; active inquiry retains eight exact legal-reference matches. | Complete |
| Build a real case with hypothesis, threads, graph, and timeline | Case `a4e2e9ef-e03d-413e-b5ee-9cbfc73b8285` retains six assets/eight findings, supported hypothesis, discussion, 208-node graph, and 10-event timeline. | Complete |
| Evaluate autopilot operation and maintain a living system brief | Twenty-eight autopilot runs were observed across exploratory, duplicate, manual review, and DREAM work; unsafe stale-state behavior was contained, the requested cycle reached zero active runs, and AI brief version 6 reflects live derived facts. | Complete |
| Expand every configured source with strategy `ALL` | Seven validated full scans processed 4,235 assets with zero per-asset errors/deletes; all source configs remain `ALL`, fully attached, terminal, and unscheduled. | Complete |
| Enable the useful detector set everywhere | PII, identifier v2, and entity v4 are attached to all seven sources; noisy/broken paths remain disabled and MiniLM remains safely unattached. | Complete |
| Wait for AI autopilot to finish, then analyze it | Five steered review agents and DREAM reached terminal state; no review-agent mutation occurred, six intended DREAM decisions persisted, stale memories were removed, and a quiet audit found zero active runs. | Complete |
| Document every gap and workaround in Markdown | This protocol records G-001 through G-035, production IDs/actions, safe repeat procedure, and fix priority. | Complete |

## Investigative result at handoff

- All seven configured sources are now investigated with a completed `ALL` scan: 4,235 active assets. Local DataSet 7 remains outside production because its 19 files still have no configured source.
- Production contains 68,987 findings: 67,242 open, 1,742 resolved, and 3 false-positive. Detector split is 39,069 PII and 29,918 custom; the dominant types are 30,121 `DATE_TIME`, 8,931 Bates numbers, 7,041 entity case numbers, 6,118 `PERSON`, and 6,084 entity event dates.
- Open findings are concentrated in DS4 (34,487) and DS12 (18,218), followed by DS1 (6,958), DS3 (4,057), DS6 (1,592), DS2 (1,420), and DS5 (510). High volume is not equivalent to investigative importance: DS4 and DS12 contain long documents with dense date/entity output.
- The strongest existing evidence remains reviewed exact recurrence: `2018R01618` in five DS6 PDFs and docket `15-CV-7433` variants in three findings. Inquiry `7699aed4-c4b1-4c4e-8eb3-d1967d23f4b5` has eight actual matches. Its stored `newMatchCount: 15` is stale (G-033).
- Case `a4e2e9ef-e03d-413e-b5ee-9cbfc73b8285` is unchanged and intact: six evidence assets, eight attached findings, one supported 0.98-confidence hypothesis with five direct support links, one quality discussion, a 208-node/205-edge graph, and a 10-event timeline.
- A new exact cross-source lead is a phone value ending `3363`, present in DS4 `EFTA00008008.pdf` and DS12 `EFTA02730274.pdf`. It is not yet a case: document context and identity must be reviewed first. Broad organization recurrence is useful for navigation but includes generic institutions and OCR fragments.
- All six `CRITICAL` records are unreviewed `CREDIT_CARD` recognizer outputs, including repeated-digit/OCR-like values. They do not currently justify escalation. The autopilot escalation agent made no alert, which matches the evidence review.
- The `ALL` runs used entity detector catalog version 4 everywhere, removing the earlier mixed-version handoff. OCR is still incomplete on some sparse/image pages: at least 409 DS1 and 297 DS2 RapidOCR calls returned empty without creating asset errors.
- DUPLICATES produced 83 current clusters, but thin-value 100% matches remain possible. Exact reverse occurrences are the evidence standard; duplicate scores are leads only.
- The requested AI cycle is fully terminal. Five review agents made zero decisions; DREAM removed all three stale source memories, retained two crisp evidence precedents, and published system brief version 6. Five configurable scan-cycle agents are paused again; DREAM remains enabled/non-enableable and DUPLICATES remains mandatory/unconfigurable.

## Safe repeatable protocol for review and future corpus changes

1. **Never narrow a populated source for an experiment.** Create a temporary source or use sandbox; otherwise out-of-scope assets can be retired (G-019).
2. **Freeze a source's detector set before its first scan.** Adding another custom detector later can auto-resolve prior findings on unchanged assets (G-021). If detector comparison is required, clone the source and compare independently.
3. **Raise `max_file_bytes` before PDF work.** Use 100 MiB for this corpus so 42 large files are not handed to parsers as truncated PDFs.
4. **Bound discovery, then progress.** One deterministic `RANDOM` sample is useful for reproducibility; switch to `AUTOMATIC` for non-repeating bounded coverage. Do not expect repeated `RANDOM` runs to broaden coverage because the seed is fixed.
5. **Treat `COMPLETED` as transport success only.** Inspect detector-specific log lines, page errors, persisted counts/statuses, and test scenarios. A detector may fail on every page while the run stays green (G-014), and empty OCR pages do not increment asset errors (G-030).
6. **Prefer exact identifiers for standing inquiries.** Use dockets, investigation references, well-formed emails, and reviewed identifiers. Avoid broad transcript PII matchers and unreviewed GLiNER case/aircraft/financial output.
7. **Verify lifecycle after every run.** Compare active/deleted assets, OPEN/RESOLVED/FALSE_POSITIVE findings, inquiry match counts, and retained finding IDs. Rematch inquiries explicitly after reconciliation.
8. **Use correlation as lead generation only.** Validate with `get_value_occurrences`; reject >100% scores and clusters dominated by Bates/page-level repetition.
9. **Keep scan-cycle autopilot paused until its state model is fixed.** Three false source memories were produced, old scan events continued after newer scans, and disabling agents did not purge an active cycle. DREAM has now deleted the false memories; use current source totals, system brief v6 facts, the two durable precedents, and human-reviewed case evidence as truth. DUPLICATES still runs because it has no toggle.
10. **Review before promoting recurrence.** Start with exact reverse-index values, then inspect both source documents. The cross-source phone lead and recurring organizations are candidates for contextual review, not automatic inquiries or cases. Source-review all `CRITICAL` PII before escalation.
11. **Decide DataSet 7 explicitly.** Its 19 local files remain outside the seven configured sources. Creating an eighth source is a separate coverage decision; do not silently fold it into an existing source.

## Product-fix priority

1. Fix cross-detector finding reconciliation (G-021) and out-of-scope deletion semantics (G-019); both can silently remove live investigative state.
2. Deduplicate correlation inputs and cap/normalize scores (G-016); existing duplicate links can be false.
3. Surface detector failures and empty OCR coverage in run status/counters (G-011/G-014/G-030), correct asset lifecycle counters (G-012), and classify model/runtime log severity accurately (G-031).
4. Fix GLiNER2 classification method compatibility (G-008), then add per-task isolation so a classification error cannot discard extracted entities.
5. Gate autopilot on a stable post-reconciliation snapshot, expire stale scan events, distinguish source totals from runner deltas/scoped profiles, make cancellation terminal, and align run summaries with recorded mutations (G-018/G-025/G-026/G-027/G-029/G-032).
6. Correct detector/source schema and MCP coverage gaps (G-001/G-002/G-005/G-009/G-010/G-013/G-017).
7. Connect embeddings to an internal semantic consumer or narrow the Feature Extraction claims; fix PDF sandbox text routing and omit inline `inputData` bytes (G-023/G-024).
8. Expose an enable/disable control for the deterministic DUPLICATES worker and include it in the agent inventory (G-028).
9. Repair inquiry match-counter reconciliation and expose stable detector keys separately from catalog versions to agents (G-033/G-035).
10. Add review/calibration support for high-severity PII recognizers so numeric/OCR-like false positives do not drive cases or alerts (G-034).
