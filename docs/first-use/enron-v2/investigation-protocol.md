# Investigation Protocol / Evidence Ledger — Enron Second Validation

```
Build under test: v0.4.58 (release commit bd584287; includes PR #206 chore/dekstop_redesign with B-1..B-5 fixes; api-runtime signature 0.4.58:127075419)
Recorded: 2026-07-19 ~12:30 CEST
Instance: desktop app, namespace cdd793d6-e39e-43a8-9c20-1ecf2e5a9ae0 (ns_eron_emails_second_trial)
API base: http://127.0.0.1:9979 (NO /api prefix — routes mounted at root; MCP at /api/mcp and /mcp)
DB: psql host=127.0.0.1 port=54320 user=classifyre dbname=classifyre, schema ns_eron_emails_second_trial
AI provider: deepseek-ai/deepseek-v4-flash (OPENAI_COMPATIBLE, id 95ded962)
Embedding space: e0e111c4 (transformers-js Xenova/all-MiniLM-L6-v2, 384 dims, pgvector 0.8.5, per-space HNSW)
Prior run docs: docs/first-use/enron/ (v0.4.57, ns_eron_mail) — referenced as "run 1" throughout.
```

## Baseline (SQL, 12:28 CEST)

sources 151 · assets 0 · findings 0 · runners 0 · detectors 0 · inquiries 0 · cases 0 · asset_chunks 0 · content_embeddings 0. Clean instance confirmed.

## Deviations / doc errors

- **D-1**: Task brief says "155 ingested sources" and API base `http://127.0.0.1:9979/api`. Reality: **151 sources**, and there is **no `/api` prefix** (`/api/*` 404s; `/instance-settings` at root answers). Both identical to run 1's D-1/OBS-2 — the brief template carries the same two errors forward.

## Pre-scan fix verification (static + endpoint level)

| Fix | Status | Evidence |
|---|---|---|
| B-5 packaging | **PASS (static)** | `api-runtime/api/transformers-embedding.worker.js` is a 1.3 MB self-contained bundle (transformers inlined; only external requires: onnxruntime-node, sharp — both present in staged node_modules). Startup log: worker registered, space e0e111c4 ready, pgvector 0.8.5. Runtime proof deferred to first scan. |
| B-5 observability | **PASS** | `/embeddings/status` now reports embeddedRows, pendingEmbedJobs, embedJobFailureCount, lastEmbedJobError, providerHealth, backfill state — the run-1 "all green while dead" shape is structurally gone (it can now tell the truth; whether it does is verified after scan). |
| Autopilot disable | PASS | All 5 agents PATCHed to enabled:false before any scan (attribution hygiene). |
| G-028 | **still open** | `PATCH /autopilot/agents/DUPLICATES` → 400 Unknown agent. Confirmed, not re-investigated. |

## Observations

(chronological; OBS-n)

- **OBS-2 (B-1 VERIFIED FIXED)**: LLM detector test scenario `ec5701f5` executed a real provider call in the test path — actualOutput carries a genuine finding (label market_manipulation, conf 0.95, verbatim quote, model deepseek-v4-flash, durationMs 146363). Run 1's silent empty-FAIL (missing provider_runtime injection) is gone. The 146 s duration also explains the run_detector_tests MCP timeout (G-009, unchanged).
- **OBS-3 (NEW BUG NB-1)**: scenario verdict said **FAIL** while `actualOutput.matched: true` and the classification matched expectations. Root cause in `apps/api/src/custom-detector-tests.service.ts:360-456`: `compareOutcome` supports expected shapes `shouldMatch` (REGEX), `label`, `entities` — but **not the `{classification: {task: {label, confidence}}}` shape the MCP tool description documents**, nor any LLM-specific branch; unrecognised shapes silently fall through to `FAIL`. Workaround: write LLM expectations as `{label: "...", minConfidence: n}`. Severity: medium (misleading verdict; truth is visible in actualOutput).
- **OBS-4 (B-3 fix active)**: semperger runner log shows docling `device of type: cpu` — the DOCLING_DEVICE=cpu setdefault landed. Runtime OCR proof pending (jpg attachments in slice).
- **OBS-5 (NEW BUG NB-2, CRITICAL, root-caused + reproduced)**: on the packaged v0.4.58 build, **every embedding write/neighbor query fails** with Postgres 42883 `operator does not exist: public.vector <=> public.vector`. Root cause: the desktop API sets connection `search_path` to the namespace schema only, so pgvector's operators (installed in `public`) are unresolvable even on fully-qualified `public.vector` operands. Reproduced in psql both ways (`set search_path to ns_…` → fails; `OPERATOR(public.<=>)` → works). The one-line fix (`search_path=${schema},public`) **exists uncommitted in the dev working tree** (apps/api/src/prisma.service.ts + export/pg-stream.service.ts) but was not in the shipped build. Failing query captured: the per-finding neighbor-scoring SQL from embedding.service.ts (`1 - (target_embedding.vec <=> neighbor.vec) AS score …`), retried every ~2 s indefinitely.
- **OBS-6 (NEW BUG NB-3, CRITICAL)**: the desktop app **crash-looped** during the first scan attempt: 5 native crash reports (12:14–12:50), `EXC_BREAKPOINT/SIGTRAP`, faulting frame `onnxruntime::BFCArena::Extend` → V8 fatal (native OOM abort) in the API child. Timing correlates with the NB-2 infinite retry loop while three scans streamed chunks into the embed queue. Consequence: all three first runs died as `ERROR "Runner was orphaned (application restarted while running)"` (counters honest about it — orphan detection worked). After one crash the app **kept running with a dead API child and never respawned it** — UI alive, backend gone, no user-visible signal (sub-finding NB-3b).
- **W-1 (documented workaround, changes build under test)**: applied the dev tree's own two-site fix to the staged bundle (`api-runtime/api/backend.js`: 2× `search_path=${schema}` → `${schema},public`; backup kept at backend.js.orig-v0458). Force-killed zombie python workers of the orphaned runs, relaunched app. Result: **embeddedRows 0 → 1620+ and climbing; embed failures stopped**. Build under test is henceforth "v0.4.58+W1". `/embeddings/status` surfaced the true error verbatim before the patch (`lastEmbedJobError` = the 42883 message) — the B-5 observability fix is honest in the field.
- **OBS-1 (corpus, blocking — resolved)**: All 195 `index.json` email files were missing from the corpus working tree (unstaged git deletions; only `attachments/` remained per account). Every one of the 151 pre-created sources pointed at an email-less folder — a scan would have silently ingested attachments only. Cause external to product (corpus repo uses git-lfs; `git-lfs` binary not on PATH, so a plain checkout also failed). Restored all 195 by resolving LFS pointers against the local `.git/lfs/objects` cache (3.4 GB, all present; restored=195 failed=0). Lesson for the product: nothing in Classifyre would have flagged that every "email account" source contained zero emails — a source-level content profile (docs vs attachments ratio) would have caught it. Corpus note: email JSON shape this run is `{"emails": [{id, attachments, body(HTML), …}]}` — bodies are HTML, not plain text as in run 1's ledger description.

## Strategy

New investigative question (deliberately different from run 1's ERCOT/forney angle): **did Enron's control functions — General Counsel James Derrick (derrick-j, 2,911 emails) and Chief Risk Officer Rick Buy (buy-r, 16,222 emails) — carry SPE and document-retention traffic in their own mailboxes, and did the West/California real-time desk (Cara Semperger, semperger-c, 1,264 emails) carry scheduling-game traffic** where run 1 only had the Texas desk? semperger-c is also the one corpus slice where run 1's 0/4-precision CA scheme-name regexes should legitimately fire.

Tiering from run-1 cost data (100-line pages; ~0.5 s/page cheap, ~6 s/page LLM): semperger 369 pages → deep tier affordable (~40 min); derrick 1,028 and buy 4,108 pages → cheap tier only (~9 / ~35 min). GLiNER deliberately dropped this run: run 1 showed accurate spans but phonebook-level investigation value at file granularity for ~6 s/page — budget goes to the LLM instead.

## Ground-truth baseline (from corpus, before any findings existed)

Grep of subject+body per email (haiku subagent, python re, verified patterns identical to detector regexes). Email-level hit counts:

| pattern | semperger-c (1,264) | derrick-j (2,911) | buy-r (16,222) |
|---|---|---|---|
| ljm | 0 | 27 | 46 |
| doc_retention | 0 | 19 | 0 |
| jedi (cs) | 0 | 6 | 6 |
| chewco | 0 | 5 | 2 |
| whitewing | 0 | 4 | 2 |
| raptor (cs) | 0 | 2 | 51 |
| osprey | 0 | 1 | 4 |
| condor (cs) | 0 | 0 | 8 |
| off_balance_sheet | 1 | 3 | 7 |
| death_star / fat_boy / ricochet / get_shorty / load_shift / litigation_hold / shredding | 0 everywhere | | |

Reading: the control-function hypothesis is **already corroborated by the corpus** — SPE traffic concentrates exactly in the CRO (buy-r: Raptor 51, LJM 46) and GC (derrick-j: LJM 27, doc-preservation 19) mailboxes, and the West desk analyst carries none of it. The CA scheme names do not appear in semperger-c at all → any detector hit there will be an FP; recall targets for the scans are the numbers above (page-level counts will differ from email-level, but zero-vs-nonzero and ordering must hold). Detector-recall check: a detector reporting 0 ljm findings on derrick-j fails recall.

## Production actions

(interface, intent, returned ID, verification)

| # | Interface | Action | Result |
|---|---|---|---|
| A-1 | REST (G-005) | PATCH /autopilot/agents/{INQUIRY,CASE,CONFIG,DETECTOR_AUTHOR,ESCALATION} enabled:false | all 5 return enabled:false |
| A-2 | MCP validate_detector_config, valid REGEX schema | **FAIL — G-001 still open** ("must match exactly one schema in oneOf"); validated locally instead |
| A-3 | MCP create_custom_detector | REGEX `enron-refs-v2` → `e418b74a` (16 patterns; JEDI/Raptor/Condor case-sensitive — run-1 FP lesson) |
| A-4 | MCP create_custom_detector | LLM `conduct-llm-v2` → `6360a50d` (5 labels, **no `none` escape label** — run-1 lesson; quote/people/rationale output fields) |
| A-5 | MCP create_detector_test_scenario + run_detector_tests | scenario `ec5701f5` (B-1 check). run_detector_tests → **MCP timeout (G-009 shape)**; result read via list_detector_test_scenarios below |
| A-6 | MCP update_source ×3 | semperger `7b1f2e3e` (regex+LLM+PII), derrick `e5985c3c` (regex+PII), buy `58feeec7` (regex+PII). PII restricted {CREDIT_CARD, PHONE_NUMBER, US_SSN, US_BANK_NUMBER} + `severity_overrides {CREDIT_CARD: low}` (G-034 fix exercised). sampling ALL |
| A-7 | MCP start_source_run ×3 | semperger run `6d730acd`, derrick `68c0bd48`, buy `5711c7e4` (12:42 CEST). New runner fields visible at creation: findingsCreated/Retained, assetsWithoutText, textCoverage, assetsOutOfScope, scopeFingerprint |
