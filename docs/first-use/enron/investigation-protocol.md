# Classifyre First-Use #2 — Enron Email Corpus — Investigation Protocol / Evidence Ledger

```
Build under test: Classifyre desktop v0.4.57 (app bundle CFBundleShortVersionString 0.4.57; api-runtime package.json 0.4.57)
Namespace: "Eron Mail" (id d0fc6d97-6e13-4c0e-932a-f67928329549, schema ns_eron_mail, created 2026-07-18T14:39Z)
API base: http://127.0.0.1:49937/api  |  Embedded PostgreSQL 18.4 on 127.0.0.1:54320
Corpus: /Users/andrii.fedorenko/development/tests/enron_mail_git2/mail (Enron email dataset, one dir per account)
Recorded: 2026-07-18T17:25 CEST
Operator: Claude (Fable 5) via Classifyre MCP tools; REST fallback documented per call.
```

## Deviations from ideal protocol

- **D-1**: Task brief said "155 ingested sources". Reality at baseline: **151 sources, 0 runs, 0 assets, 0 findings** — sources were created (2026-07-18 ~15:08Z) but never scanned. This run therefore includes detector configuration and first scans, which matches the skill protocol (configure before first scan). Not starting from a truly empty instance, but attribution is clean: everything scanned from here on is attributable to this run.
- **D-2 (anomaly, OPEN)**: Desktop main.log shows CliRunnerService/presidio recognizer-loading activity at 17:07 CEST today despite `search_runs` returning 0 runs. Unexplained at baseline. To watch.

## Baseline (2026-07-18 17:22 CEST, via MCP)

| Entity | Count |
|---|---|
| Sources | 151 (all LOCAL_FOLDER, all runnerStatus PENDING, latestRunner null) |
| Runs | 0 |
| Findings | 0 |
| Custom detectors | 0 |
| Inquiries / Cases | (to verify) |

Source config shape at baseline (sample `mail_skilling-j`, `03a5f5dc-778a-43f2-a0fd-ee38f8b7f478`): only `required.path` + `sampling.strategy: AUTOMATIC`. No detectors, no custom_detectors, no traversal/scope options set. `aiMode: INHERIT`.

- **OBS-1 (GAP/UX)**: `search_sources` totals block reported `{total:151, healthy:0, errors:0, running:151}` while every item is `PENDING` with no runner — "running: 151" is wrong labelling for never-run sources.

## Ledger

(chronological entries follow)

### 17:25 — Baseline complete

- Inquiries: 0. Cases: 0. Custom detectors: 0. Confirmed clean investigative baseline.
- **OBS-2 (DOC)**: Task brief gave API base `http://127.0.0.1:49937/api`. Wrong — the NestJS app sets no global prefix; routes live at root (`/ai-provider-configs` answers, `/api/ai-provider-configs` 404s). Only MCP is additionally mounted under `/api/mcp`. Cost: ~4 wasted probes. Documentation issue.
- **REST fallback #1**: `GET /ai-provider-configs` — needed to know whether LLM detectors are possible (aiProviderConfigId is required for LLM pipeline). MCP has no tool to list AI provider configs. **GAP (MCP)**. Result: one config, `deepseek-ai/deepseek-v4-flash` (OPENAI_COMPATIBLE, NVIDIA integrate endpoint, id `c696a2c3-6ae0-4151-b160-0273ace06bcd`, contextSize 1M, vision). PASS.
- Corpus profiling delegated to a subagent (read-only shell over the maildir); results pending.

### 17:24–17:30 — Phase 1: detector set created and frozen (before any scan)

- `test_source_connection(mail_skilling-j)` → SUCCESS, "Found 100+ object(s)". PASS. (Note: count caps at "100+", not exact — minor.)
- **G-001 CONFIRMED on v0.4.57**: `validate_detector_config` rejects a valid bare REGEX pipeline schema with `data must match exactly one schema in oneOf`. Proceeded to create without validation; creation accepted the identical schema. One line, moving on.
- Created 3 custom detectors (MCP `create_custom_detector`, all PASS):
  1. `enron-deal-refs` (`ce118f67`) — REGEX, 15 patterns: SPE codenames (ljm, raptor, chewco, jedi, whitewing, osprey, braveheart, talon, condor), CA scheme names (death_star, ricochet, fat_boy, get_shorty), off_balance_sheet, shredding.
  2. `enron-entities` (`74bbeab6`) — GLiNER2: person, organization, money_amount.
  3. `suspicious-conduct-llm` (`98b069d3`) — LLM (deepseek-v4-flash provider), labels: document_destruction, market_manipulation, accounting_concealment, insider_stock_activity, legal_risk_discussion, none; multi_label, threshold 0.6, output fields people_involved + rationale.
- Built-in PII will be attached per-source with a restricted entity set (US_SSN, CREDIT_CARD, US_BANK_NUMBER, IBAN_CODE, PHONE_NUMBER) and PHONE_NUMBER→low override.
- Detector tests:
  - REGEX scenario: **all 6 expected patterns matched with correct offsets — detector verified working** — but the harness reported `status: FAIL` while `actualOutput.matched: true`. **OBS-3 (BUG candidate, test comparator)**: expected-outcome comparison appears to require exact shape equality (e.g. confidence values) rather than subset matching; a fully-correct run scores FAIL. Misleading in exactly the way that makes people skip testing.
  - **OBS-4 (echo of G-016b)**: every finding in the test response embeds the entire page's `extracted_data` entity dump — 6 findings × full dump in one response; the MCP response needed truncation for a 230-char input. Storage/response amplification visible at the smallest possible scale.
  - GLiNER test: MCP client **timed out** (G-009 shape; expected on first model load). Persisted result read back via `list_detector_test_scenarios`: **PASS** — all 6 entities extracted with exact spans (model fastino/gliner2-base-v1, latency 96s first load, WORKAROUND per playbook). Note the same subset-style expected outcome PASSed here but FAILed for REGEX → OBS-3 comparator inconsistency is detector-type-specific.
  - LLM test: **zero findings, no error, twice** (4.5s then 1.2s after threshold lowered to 0.2 — too fast for a model roundtrip). Root-caused in code: **B-1 (CONFIRMED BUG, backend/detector-tests)** — `custom-detector-tests.service.ts` passes `detector.pipelineSchema` raw to CLI `evaluate-file` (line ~245) with no `provider_runtime` injection; `apps/cli/src/detectors/custom/runners/_llm.py:57` raises ValueError when `provider_runtime` is missing; the test service swallows it → `status: FAIL, findings: [], errorMessage: null`. **LLM detectors cannot be tested via scenarios and the failure is completely silent.** Real scan path (custom-detectors.service.ts `injectProviderRuntime`) does inject credentials, so scans should work — to be proven by run `detector_outcomes`. Threshold restored to 0.5 (detector v3).

### 17:31 — Corpus profile (subagent, read-only disk scan)

- 151 account dirs, **377,321 files, 14 GB**. NOT raw RFC-822 maildir: each account holds 1–5 pre-parsed `index*.json` files (arrays of email objects: from/to/cc/subject/date/body/folder/has_attachments; MD5 ids) plus an `attachments/` tree with real files. Extension histogram dominated by .doc (187k incl. case variants), .xls (65k), .dat (25k), .pdf (23k), .ppt (18.6k), images. Largest index JSON 42.4 MB (dasovich-j).
- Largest accounts: kean-s 73,958 files/2.6G; dasovich-j 27,885/1.2G; taylor-m 23,007/816M; kaminski-v 22,368/687M. Smallest: meyers-a 26 files. Slice candidates: **forney-j 161 files/8.5M** (ran CA schemes), skilling-j 3,398/170M, symes-k 4,825/200M, lay-k 2,244/109M. No fastow-a account (historically accurate — Fastow's mailbox was never released).
- **Consequence for ingestion**: LOCAL_FOLDER's asset = file. One asset will be a multi-MB JSON containing thousands of emails → findings will locate into JSON blobs, not individual emails; and default `max_file_bytes` 10 MiB would silently truncate the larger index files. Mitigation: set `traversal.max_file_bytes` to 100 MiB on slice sources. This granularity mismatch is itself a product observation for email corpora (no EMAIL-index/JSONL splitter for local folders).
- D-2 resolved: main.log shows runner `91a1f1df` ERRORed 17:07 for source `8fe5e4c6` which was then deleted (schedule-removal line) — operator's pre-handoff experiment, not part of our 151. Benign.

### 18:39–19:05 — Parallel-run errors: two new confirmed bugs

- lay-k run `0c769070` reported 3 asset errors (progress endpoint). Runner NDJSON logs give exact causes:
- **B-2 (CONFIRMED BUG, ingestion/embeddings)**: all 3 failures are copies of `COPPSS~1.TXT` — a **WordPerfect binary with a .TXT extension**. Text extraction trusts the extension, produces control-character garbage, and `POST /sources/{id}/embeddings/chunks` returns **500 Internal Server Error** (most likely ` ` rejected by Postgres). The 500 fails the *entire asset*, not just its embedding. Repro: any WP binary named .txt. Expected: sanitize text before embedding ingestion; embedding failure should degrade, not fail the asset.
- **B-3 (CONFIRMED BUG, ingestion/OCR, platform)**: **all TIFF/image OCR fails on Apple Silicon** — docling layout stage: `Cannot convert a MPS Tensor to float64 dtype as the MPS framework doesn't support float64`. 361 occurrences in lay-k alone. On the desktop product's primary platform, scanned-image attachments contribute zero text (they degrade to WARNING + no-text, not asset errors). Fix is a known torch/docling device workaround (float32 or CPU fallback).
- Attachment scanning throughput without GLiNER/LLM is good: ~2,200–4,800 attachments per source processed in ~20 min, in parallel.

### 19:05–19:30 — Run honesty verified; counter regression found; autopilot reined in

- **Run honesty (G-014/G-030 fixes): VERIFIED in the field.** lay-k run `0c769070` finished **WARNING** (not green) with errorMessage "3 of 2239 assets failed processing; 71 assets had incomplete text extraction", `assetsWithoutText: 1571`, and a full `textCoverage` histogram (extracted 525 / empty 1500 / failed 71 / notApplicable 143). Empty-text visibility works; 1,500 "empty" are the zero-text sub-100-byte placeholder attachments plus MPS-failed OCR images.
- **B-4 (CONFIRMED REGRESSION, runner counters — G-012/G-020 shape)**: lay-k's **first-ever** run reported `assetsCreated: 0, assetsUnchanged: 2239`. REST `GET /assets/b70bfbad…` shows `createdAt: 16:39:20Z` — created *during* that run (started 16:38:32Z). A first run of N new assets must report `assetsCreated: N`. The watch list said this was fixed by per-run immutable `change_type` in v0.4.54; on v0.4.57 with LOCAL_FOLDER it does not hold. **Highest-priority bug of this test.**
- **OBS-7 (BUG, MCP serialization)**: `list_source_assets` and `search_sources` return `createdAt/updatedAt/lastScannedAt` as `{}` (empty objects) — Date serialization loss in MCP tool output. Forced a REST fallback to read timestamps (documented above).
- **Autopilot acted uninvited**: enabled by default, it ran 6 runs today (INQUIRY/CASE/CONFIG/DETECTOR_AUTHOR/ESCALATION/DUPLICATES), applied 21 decisions, wrote 3 memories, and at 17:13Z triggered its own rescan of lay-k (`f8c1baca`, still RUNNING) minutes after my manual run finished. For attribution I disabled all 5 enableable agents via REST `PATCH /autopilot/agents/:kind` (G-005 — no MCP surface for any of this). Its earlier CONFIG activity also explains the 17:07 deleted-source runner anomaly (D-2). The uninvited rescan is a free idempotency test: finding IDs should be retained (checked below). Autopilot evaluation deferred to a dedicated phase.

### 19:30–19:55 — B-5: semantic stack is dead on the desktop build (silently)

- Symptoms: `search_assets` with `semantic_query` always returns `ranking.mode: "lexical-fallback"`; `semantic_mode: "vector"` errors with **`Semantic query embedding failed: this.tokenizer is not a function`**.
- `GET /embeddings/status` claims perfect health: `enabled, pgvector 0.8.5, workerRegistered, persistentQueue, pendingQueueWrites: 0, backfillCompleted`.
- DB ground truth (embedded Postgres, ns_eron_mail): **`asset_chunks` = 115,887 rows; `content_embeddings` = 0 rows.** Nothing has ever been embedded.
- Root cause (packaging): `api-runtime/api/node_modules` contains `onnxruntime-node`/`onnxruntime-common` but **no @xenova/@huggingface transformers package** — the `transformers-js` provider can't construct its tokenizer; every embedding attempt fails and is swallowed with zero log lines (main.log has no embedding errors at all).
- Consequence: **all semantic functionality is non-functional on desktop v0.4.57** — semantic search (hybrid silently degrades to lexical), vector search (hard error), find_similar_findings, boilerplate clusters, semantic ranking reasons. "Semantic detector" value in this test reduces to the LLM detector (which works, via provider API).
- **B-5 (CONFIRMED BUG, packaging + observability)**: two defects — the missing package, and the health endpoint lying while the worker fails silently. The earlier B-2 asset failures (embeddings/chunks 500) are unrelated to this: those are input-sanitization failures on the write path.
- Also verified the "shredded" regex hit in skilling-j at source: an unrelated McKinsey manuscript email ("have the copy properly shredded", 2001-07-17) — benign; regex without context is a lead generator, not evidence. Extraction offsets are stored **relative to an unrecorded 100-line page** (OBS-8, GAP): findings on paginated assets cannot be traced to the containing email through the product; verification requires grepping the original corpus.

### 19:25–19:35 — Phases 3/4: judging findings, first cases

Finding-type breakdown (read-only SQL over ns_eron_mail — **GAP: no aggregation/faceting on MCP**; a "findings by type per source" table required raw SQL):
- forney-j (full tier): person 1190, organization 281, money 129, LLM `none` 47, PHONE 15, LLM market_manipulation 4, legal_risk 4, document_destruction 1, ljm 1.
- lay-k / skilling-j / symes-k (cheap tier): PHONE 74–235 each; deal-refs: lay-k {ljm 4, chewco, jedi, whitewing, raptor, osprey, ricochet, off_bs 5}, skilling {ljm 6, osprey 6, jedi, raptor, fat_boy, ricochet, shredding, off_bs}, symes {raptor, death_star, off_bs 2}; lay-k CREDIT_CARD 7 (to judge).
- **Design lesson (mine): including a `none` label in the LLM detector creates 47 noise findings.** Exclude the null label; rely on threshold.

Verification against original corpus (the decisive step):
- **VERIFIED GENUINE**: (1) Forney ERCOT desk instructions — "DO NOT GO TO THE POOL… call Jerry and wake him up. Have him ramp up" (Drafts, "Frontera Position for tomorrow"); "tell these guys to trade it up!" (Sent, 2001-11-16); Frontera imbalance-price positioning. LLM matchedContent quotes + people_involved + rationale made these directly checkable. (2) Litigation hold 2001-10-26 "Important Announcement Regarding Document Preservation" — in forney-j **Deleted Items**. (3) lay-k SPE hits = the November 2001 8-K restatement announcement text (JEDI/Chewco retroactive consolidation, $561–711M/yr debt).
- **FALSE POSITIVES (marked in product with comments via bulk_update_findings)**: symes-k `death_star` = Enron IT server "E10K deathstar" (with "yoda"/"skywalker"/"Chewbacca" — Star Wars server names); skilling `fat_boy` = Harley-Davidson Fat Boy prize; `ricochet` ×2 = Metricom Ricochet wireless ISP. **Every California-scheme-name regex hit outside forney was an FP** — context-free scheme-name regexes are dominated by unrelated commercial uses; the LLM detector, not the regex, produced the real market-manipulation signal.
- LLM near-duplicates: the same Frontera email produced two findings with slightly different spans (chunk-overlap duplicate; OBS-9, dedup gap).

Product structure built (all MCP, all PASS): inquiries `9d7a19ec` (SPE web, 25 matches) and `7672e784` (LLM conduct, 5 matches); cases `18d0b86d` (Forney ERCOT desk, HIGH) and `4a70223c` (SPE concealment trail, HIGH) with hypotheses (SUPPORTED, 0.75/0.85), finding attachments (4+7), weighted support links, and four dated chronology events (litigation hold 2001-10-26 @DAY; restatement @MONTH; trade-it-up 2001-11-16 @DAY; Frontera draft 2002-11-30 @DAY with caveat). Note: thread support links echo back different `targetId`s than the finding IDs passed (join-row ids?) — labels match; cosmetic confusion (OBS-10).
- Expansion: delainey-d (insider-trading angle) launched on cheap tier as run `0f2175bf`. LLM tier stays forney-only: 393k lines ≈ 6.5 h — **deep-tier scanning is a one-mailbox luxury on this build** (product evaluation point, not a bug).

### 19:35–19:45 — Findings triage + autopilot audit

- **lay-k CREDIT_CARD ×7: all FP** — suite-number + phone concatenations ("1130 713-622-5360") at confidence 1, severity CRITICAL. Marked FALSE_POSITIVE with comment. **"Every CRITICAL is a recognizer artifact" replicates from the first run** on a completely different corpus.
- **Autopilot audit (REST, G-005)**: its 6 runs and 21 decisions verified against persisted state, not summaries:
  - It **independently diagnosed the same CREDIT_CARD FP pattern** (memory `credit_card_false_positive_phone_numbers`), **disabled CREDIT_CARD** in lay-k's PII config (verified in `get_source`: enabled_patterns no longer contains CREDIT_CARD), **authored a new REGEX detector `enron-spe-refs`** (verified: exists, single sane pattern for "special purpose entity|SPE", wired into lay-k), and triggered rescan `f8c1baca` — tagged its memories `pending-verification`. Summaries match persisted decisions (`decisionCount` consistent; DUPLICATES runs report deterministic fingerprint stats). **This is a large improvement over the first run's false-memory behavior.**
  - Caveat: it silently mutated an operator-authored source config minutes after I saved it. Defensible on evidence, but there is no notification/consent surface for "the AI edited your source config" (OBS-12, product judgment).
  - **OBS-11 (BUG, small)**: autopilot memory timestamps store local time with a `Z` suffix (createdAt "19:19:40Z" written at 17:19Z real time).
  - Its lay-k rescan is now a live G-021 fix test: detector set changed (CREDIT_CARD off, SPE detector added) + rescan → pre-existing deal-ref findings must keep their IDs and stay OPEN, and my FALSE_POSITIVE marks must survive. To verify at completion.

### 20:22–20:35 — Lifecycle verification (the big one) + graph/similarity checks

- **G-021 fix VERIFIED on a real corpus.** Autopilot rescan `f8c1baca` of lay-k ran with a *changed* detector set (CREDIT_CARD disabled, new `enron-spe-refs` added): result `findingsResolved: 0, findingsRetained: 236, assetsDeleted: 0`; pre-existing deal-ref findings kept identical IDs (`5f4ab85c`, `d029d302`, `15309a39`, `df8417a8` spot-checked); my FALSE_POSITIVE statuses and comments survived intact. The bug class that destroyed investigative state in run 1 did not fire.
- The autopilot's `enron-spe-refs` detector produced 0 findings on rescan — verified **correct** at source: neither "special purpose entity" nor standalone "SPE" occurs in lay-k/index.json. Its hypothesis was reasonable and its own verification run disproved it. Working as designed.
- `find_similar_findings` → honest error "no stored vector" (B-5 downstream). `get_value_occurrences("LJM")` → empty (correlation value index not populated for regex values — OPEN, revisit after recompute).
- **OBS-13 (product judgment, granularity)**: `get_case_graph` on the SPE case returns a ~200-node depth-1 neighbourhood of unrelated contact names/phone numbers, because evidence assets are whole-mailbox index.json files. At file granularity the "evidence neighbourhood" concept collapses on email corpora. Granularity is the single biggest product-fit problem this test surfaced (with B-5 and performance as the top bugs).
- delainey-d cheap-tier run completed: 1,343 assets, 0 errors (record to pull).

### 21:15 — Close-out

- forney-j run `a3553abb` was **manually stopped by the operator** at ~page 370/468 after ~3h40m. Runner records `status: ERROR, errorMessage: "Manually stopped"`, `durationMs: null` despite completedAt set. **OBS-14**: an operator stop reporting as ERROR (no CANCELLED state for runners) misattributes intent, and the null duration is a counter gap. Findings up to the stop point (2,103 in that run) were retained; nothing auto-resolved. Partial-scan semantics behaved safely.
- **Final instance state** (SQL audit): 11,963 assets · 2,681 findings (2,670 OPEN, 11 FALSE_POSITIVE by manual triage) · LLM detector final tally: market_manipulation 17, legal_risk_discussion 4, document_destruction 2, `none` 64 · 4 custom detectors (3 mine + 1 autopilot-authored) · 2 inquiries (28 + 5+ matches) · 2 cases with hypotheses, 14 attached findings, 4 chronology events.
- Deliverables written: `investigation-protocol.md` (this ledger), `bugs.md`, `improvements.md`, `cases-and-findings.md`, `product-evaluation.md`, `classifyre-enron-blog-post.md` (justified: two verified cases).

### 17:32–18:40 — Phase 2: bounded first run (forney-j) + the performance wall

- `start_source_run(mail_forney-j)` → runner `a3553abb`, ALL strategy, 160 assets (1 index.json + 159 attachment files). Per-asset REST progress (G-013 WORKAROUND) worked well: 159/160 done in ~6 min, **0 errors**.
- Run logs are excellent at INFO level: per-detector per-page timings, matched values inline. Pool sizing: `cpu_budget=9, mem_budget=1 (4096MB), effective=1` — **single worker** despite 10 CPUs; memory budget is the binding constraint.
- **LLM detector confirmed working on the real scan path** (openai client calls + retries visible in logs) — B-1 is confined to the test-scenario path.
- **OBS-5 (PERFORMANCE, the headline)**: the 4.3 MB `index.json` (46,707 lines) is paginated at 100 lines/page → 468 pages. Early pages ~34 s (cold models), warm pages ~6–7 s. One small mailbox ≈ 1–4.5 h with GLiNER+LLM attached. Extrapolation: skilling-j index = 8,146 pages; dasovich-j = 45,906 pages; kean-s far more. **Full-corpus deep scanning is computationally unreachable on this build/hardware**; detector cost forces explicit tiering, which the product does not guide you toward. Also ~20 s/page of early-run time was not attributable to any detector in the per-page log (visible as 34 s total vs ~12 s summed detectors) — unexplained overhead, later mostly gone; OPEN.
- **Strategy decision D-3**: tier the detectors. forney-j keeps full depth (REGEX+GLiNER+LLM+PII). lay-k (`0c769070`), skilling-j (`efa36ea2`), symes-k (`f3a459f1`) launched in parallel at 18:38 with REGEX deal-refs + PII only. Semantic embeddings accrue from ingestion regardless, so semantic search remains testable corpus-wide on scanned sources.
- Finding-quality preview at n=657: GLiNER `entity:person` dominate; values include contact-list rows with embedded `\t` ("Pavluk\t Peter") — extraction is faithful to the underlying JSON text (tabs and all), fine for recurrence, noisy for display. **All GLiNER entity findings carry severity HIGH by default** — severity≠evidence again, at the schema default level (OBS-6, product judgment).
