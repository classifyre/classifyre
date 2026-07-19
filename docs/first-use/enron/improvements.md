# Classifyre — Product Improvement Recommendations (Enron First-Use #2)

Source: `docs/first-use/enron/investigation-protocol.md` (evidence ledger) and `docs/first-use/enron/bugs.md` (bug report), both recorded 2026-07-18 against desktop v0.4.57. Every recommendation below is tied to a specific marker from those documents; nothing here is invented.

---

## I-1 — Email-aware ingestion granularity (per-email assets, not per-file)
- **Problem** (observed): LOCAL_FOLDER treats one asset = one file. The Enron corpus stores each mailbox as pre-parsed `index*.json` arrays of thousands of emails, so findings locate into a multi-MB JSON blob rather than an individual email (OBS-8: "extraction offsets are stored relative to an unrecorded 100-line page... findings on paginated assets cannot be traced to the containing email through the product; verification requires grepping the original corpus"). The same file-level granularity collapses `get_case_graph` into a ~200-node neighbourhood of unrelated contact names/phone numbers because "evidence assets are whole-mailbox index.json files" (OBS-13). It also drives the 100-line/page pagination that produces 468 pages for one mailbox (OBS-5).
- **User impact**: An investigator cannot answer "which email did this finding come from?" without leaving the product and grepping the raw corpus. Case graphs meant to reveal a suspect network instead render as an indiscriminate phonebook, defeating the graph-explorer's purpose for the single most common unstructured-data shape (email).
- **Proposed improvement**: Add an EMAIL/JSONL-aware splitter for LOCAL_FOLDER (or a dedicated `EMAIL_ARCHIVE`/`EMAIL_INDEX` source type) that explodes multi-email container files (mbox, index.json arrays, PST/EML trees) into one logical asset per email at ingestion time, carrying message-id, from/to/cc, subject, date, and folder as first-class asset metadata. Findings, embeddings, and graph edges should all resolve to the email asset, not the container file.
- **Expected benefit**: Findings become traceable to a specific email inside the product (closes OBS-8); case graphs reflect actual correspondent relationships instead of every name mentioned anywhere in a mailbox (closes OBS-13); pagination collapses from hundreds of pages per mailbox to one page per email, directly shrinking the OBS-5 cost problem.
- **Priority**: P0
- **Area**: ingestion

---

## I-2 — Fix and monitor the semantic/embedding stack end-to-end
- **Problem** (observed): B-5 — the desktop build ships `onnxruntime-node`/`onnxruntime-common` but no `@xenova`/`@huggingface` transformers package, so every embedding attempt fails and is swallowed with zero log lines. `GET /embeddings/status` reports full health (`enabled, workerRegistered, persistentQueue, pendingQueueWrites: 0, backfillCompleted`) while the database shows `asset_chunks = 115,887` rows and `content_embeddings = 0` rows. `search_assets` with `semantic_query` silently falls back to `ranking.mode: "lexical-fallback"`, and `semantic_mode: "vector"` hard-errors with `this.tokenizer is not a function`.
- **User impact**: Semantic search, vector search, `find_similar_findings`, boilerplate clusters, and semantic ranking reasons are entirely non-functional on desktop, but nothing in the product tells the investigator this — the health check lies and hybrid search degrades invisibly. An investigator trusting semantic recall believes they searched by meaning when they only searched by keyword.
- **Proposed improvement**: (1) Bundle the missing transformers dependency in the desktop packaging pipeline so the embedding provider can construct its tokenizer. (2) Change `/embeddings/status` from a service-registration check to a real end-to-end probe: embed a small canary string and confirm a vector round-trips into `content_embeddings`. (3) Surface "semantic degraded to lexical" prominently in the response itself (e.g. a `ranking.degraded: true` + reason field returned inline with search results), not just in a separate status endpoint, so degradation is visible at the point of use.
- **Expected benefit**: Restores the product's core semantic capabilities on its primary platform; turns a silent, misleading health signal into an actionable one; prevents investigators from unknowingly working with lexical-only search.
- **Priority**: P0
- **Area**: semantics

---

## I-3 — Detector cost tiering and pre-scan guidance
- **Problem** (observed): OBS-5 — a single 4.3 MB mailbox (`forney-j`, 46,707 lines) paginates into 468 pages; with GLiNER+LLM attached, one small mailbox took 1–4.5 hours, and extrapolation puts `dasovich-j` at 45,906 pages and `kean-s` higher still — "full-corpus deep-tier scanning is computationally unreachable on this build/hardware," and the product gives no guidance steering users away from this trap. The operator had to manually invent detector tiering (D-3: full depth on one mailbox, REGEX+PII-only on the rest) to make the corpus tractable at all.
- **User impact**: A user who simply attaches all detectors to all sources — the naive, discoverable path — will unknowingly commit to scans measured in days with no warning, and no way to know beforehand which detector is the expensive one.
- **Proposed improvement**: Before a scan starts, show a per-detector, per-page cost estimate (based on recent latency history: cheap REGEX/PII vs. GLiNER model-load vs. LLM roundtrip) and a projected total duration for the source, with an explicit warning when deep detectors are attached to large sources. Support detector cascading/chaining — e.g., run a cheap regex or entity pre-filter first and only invoke GLiNER/LLM on pages that hit the pre-filter — so the expensive detectors don't have to run on every page.
- **Expected benefit**: Turns an invisible performance cliff into an informed, bounded choice; cascading can cut deep-detector invocations by orders of magnitude on corpora shaped like this one, making full-corpus deep scanning newly reachable.
- **Priority**: P0
- **Area**: performance

---

## I-4 — Fix assetsCreated counter regression on first-ever runs
- **Problem** (observed): B-4 — lay-k's first-ever run reported `assetsCreated: 0, assetsUnchanged: 2239`, even though `GET /assets/b70bfbad…` shows `createdAt: 16:39:20Z`, i.e. created during that very run (started 16:38:32Z). The ledger notes the watch list claimed this was fixed by per-run immutable `change_type` in v0.4.54, but on v0.4.57 with LOCAL_FOLDER sources it does not hold, and flags it "highest-priority bug of this test."
- **User impact**: Run summaries — the primary signal an investigator uses to sanity-check a scan — are simply wrong on the most common case (first scan of a new source), undermining trust in every other counter the product reports.
- **Proposed improvement**: Fix the `change_type` computation for LOCAL_FOLDER's first run so newly-created assets are attributed to `assetsCreated`, and add a regression test that specifically covers "first-ever run on a fresh LOCAL_FOLDER source" (not just re-runs), since that is the scenario that broke.
- **Expected benefit**: Restores basic run-summary trustworthiness; prevents this counter class from regressing silently again given it already regressed once between v0.4.54 and v0.4.57.
- **Priority**: P0
- **Area**: ingestion

---

## I-5 — Sanitize text before embeddings write; degrade instead of failing the asset
- **Problem** (observed): B-2 — a WordPerfect binary named `COPPSS~1.TXT` is trusted by extension, produces control-character garbage, and `POST /sources/{id}/embeddings/chunks` returns a 500 (likely a rejected null byte), which fails the *entire asset*, not just the embedding step. All 3 asset errors on the lay-k run were copies of this one file.
- **User impact**: A single malformed attachment silently deletes an otherwise-successful asset's findings and text extraction from the run, with no recovery — text extraction that succeeded is thrown away because a downstream, unrelated step (embedding) choked.
- **Proposed improvement**: Sanitize extracted text (strip/escape null bytes and other Postgres-incompatible control characters) before the embeddings write path. Decouple embedding failure from asset success — an embedding failure should degrade the asset to "no embeddings" (already-established pattern per the `textCoverage` histogram work) rather than fail it outright.
- **Expected benefit**: Removes an entire class of ingestion failures caused by content, not logic; keeps text extraction and findings even when embeddings can't be generated for a given file.
- **Priority**: P1
- **Area**: ingestion

---

## I-6 — MPS float64 OCR fix for Apple Silicon
- **Problem** (observed): B-3 — the docling layout stage errors with `Cannot convert a MPS Tensor to float64 dtype as the MPS framework doesn't support float64`, 361 occurrences in lay-k alone; all TIFF/scanned-image OCR fails on the product's primary desktop platform (Apple Silicon). It degrades to a WARNING + no-text state rather than an asset error, so it's easy to miss.
- **User impact**: Every scanned-image attachment on the desktop app's primary hardware contributes zero text — a systematic, platform-wide extraction gap that is easy to overlook because it doesn't surface as a failure.
- **Proposed improvement**: Apply the known torch/docling device workaround (force float32, or CPU fallback for the layout stage when running on MPS devices).
- **Expected benefit**: Recovers OCR text from all scanned-image attachments on Apple Silicon, which per the corpus profile is a large share of file types (images, TIFFs) across 151 accounts.
- **Priority**: P1
- **Area**: ingestion / performance

---

## I-7 — Robust content-type sniffing independent of file extension
- **Problem** (observed): Root cause shared by B-2 (WordPerfect binary trusted as `.txt`) — text extraction "trusts the extension" rather than the actual file content.
- **User impact**: Any mismatch between a file's declared extension and its real format silently corrupts extraction and can cascade into asset failure (as in B-2).
- **Proposed improvement**: Add a content-sniffing step (e.g. magic-byte/MIME detection) ahead of extension-based extractor dispatch, and route mismatches to the correct extractor or a clear "unsupported binary" state instead of feeding garbage into text/embedding pipelines.
- **Expected benefit**: Prevents an entire class of extension-mismatch failures beyond the one WordPerfect case observed, closing the underlying defect B-2 only patches at the symptom.
- **Priority**: P1
- **Area**: ingestion

---

## I-8 — Inject provider_runtime in the LLM detector test path; never swallow errors into empty-FAIL
- **Problem** (observed): B-1 — `custom-detector-tests.service.ts` passes `detector.pipelineSchema` raw to CLI `evaluate-file` (line ~245) with no `provider_runtime` injection; `apps/cli/src/detectors/custom/runners/_llm.py:57` raises `ValueError` when `provider_runtime` is missing; the test service swallows this into `status: FAIL, findings: [], errorMessage: null`. The real scan path (`custom-detectors.service.ts` `injectProviderRuntime`) does inject credentials and works correctly (confirmed via visible openai client calls/retries on the forney-j scan).
- **User impact**: LLM detectors cannot be tested via scenarios at all, and the failure is completely silent — a user has no way to distinguish "my detector doesn't match anything" from "the test harness is broken," and will reasonably conclude their detector doesn't work when it actually does.
- **Proposed improvement**: Mirror the real scan path's `injectProviderRuntime` call in `custom-detector-tests.service.ts` before invoking `evaluate-file`. Separately, stop swallowing CLI errors into a bare `FAIL` with `errorMessage: null` — propagate the underlying exception message into the test result.
- **Expected benefit**: Makes LLM detector testing actually usable pre-scan, and the second fix (never swallow errors) prevents this whole class of "false FAIL with no explanation" regardless of root cause.
- **Priority**: P0
- **Area**: detectors

---

## I-9 — Findings ergonomics: context snippets, page/offset anchors, chunk-overlap dedup, entity severity defaults
- **Problem** (observed): Multiple findings-quality gaps: OBS-8 (extraction offsets anchored to an unrecorded 100-line page, findings untraceable to their source email without grepping the raw corpus); OBS-9 (the same Frontera email produced two LLM findings with slightly different spans due to chunk overlap — a dedup gap); OBS-6 (all GLiNER entity findings carry severity HIGH by default, regardless of evidentiary weight).
- **User impact**: Findings are hard to verify in-product (must go external to confirm context), duplicate near-identical findings inflate apparent evidence volume, and severity badges mislead triage priority for an entire detector class.
- **Proposed improvement**: (1) Populate contextBefore/contextAfter snippets on regex findings — the ledger notes these are currently null. (2) Store and expose stable page/offset anchors (or, once I-1 lands, email-relative anchors) so a finding can be traced back to its source location in-product. (3) Add chunk-overlap-aware deduplication so near-duplicate spans from overlapping chunks collapse into one finding. (4) Make GLiNER/entity-detector severity configurable or computed from more than a static schema default rather than uniformly HIGH.
- **Expected benefit**: Findings become independently verifiable inside the product; finding counts stop being inflated by chunking artifacts; severity starts correlating with actual risk, improving triage speed.
- **Priority**: P1
- **Area**: findings

---

## I-10 — Aggregation/faceting endpoint on MCP
- **Problem** (observed): Ledger: producing a "findings by type per source" table required dropping to raw SQL over the database — "GAP: no aggregation/faceting on MCP" — for a query an investigator would routinely need.
- **User impact**: Basic analytical rollups of findings (by type, by source, by severity) are unavailable through the product's own tool surface, forcing direct database access that most users won't have or shouldn't need.
- **Proposed improvement**: Add an MCP (and REST) endpoint for findings aggregation/faceting — group-by type/source/severity/status with counts — mirroring what the SQL workaround produced.
- **Expected benefit**: Removes a documented dependency on raw SQL for a routine triage task; makes the finding-type breakdown workflow used throughout this investigation available to any user.
- **Priority**: P1
- **Area**: MCP / API

---

## I-11 — Fix MCP Date serialization ({} instead of timestamps)
- **Problem** (observed): OBS-7 — `list_source_assets` and `search_sources` return `createdAt`, `updatedAt`, and `lastScannedAt` as `{}` (empty objects) instead of timestamps, forcing a REST fallback to read real timestamps (this was in fact required to confirm B-4).
- **User impact**: Timestamp data — needed for run-order reasoning, staleness checks, and (as demonstrated) confirming counter bugs — is unusable through MCP, the primary interface this product is evaluated through.
- **Proposed improvement**: Fix the Date serialization in the MCP tool response layer so timestamps round-trip as ISO strings rather than empty objects.
- **Expected benefit**: Closes a documented, reproducible MCP data-loss bug and removes a class of forced REST fallbacks.
- **Priority**: P1
- **Area**: MCP

---

## I-12 — Close MCP surface gaps used only via REST (AI provider configs, autopilot control, per-run progress)
- **Problem** (observed): Three separate REST fallbacks were required in this single run because MCP has no equivalent: listing AI provider configs (needed to know whether LLM detectors are possible at all — "MCP has no tool to list AI provider configs. GAP (MCP)"); autopilot agent control (G-005 — disabling autopilot agents required REST `PATCH /autopilot/agents/:kind` per agent, "no MCP surface for any of this," and G-028 confirms no toggle exists even at the REST layer for the DUPLICATES agent kind specifically); and per-run progress polling (G-013, used as a workaround to track the forney-j run's 159/160 asset completion).
- **User impact**: An MCP-only user (the intended interface for this product, per the ledger's operator note) cannot discover LLM-detector feasibility, cannot control autopilot, and cannot poll run progress without dropping to REST — undermining MCP as a complete interface.
- **Proposed improvement**: Add MCP tools for (a) listing AI provider configs, (b) autopilot agent enable/disable per kind including DUPLICATES specifically, and (c) per-run progress/asset-completion polling, matching what the REST endpoints already provide.
- **Expected benefit**: Makes MCP a self-sufficient interface for the workflows this investigation actually needed, closing three separately-documented gaps in one pass.
- **Priority**: P1
- **Area**: MCP / autopilot

---

## I-13 — Fix or document the REGEX vs GLiNER test-scenario comparator inconsistency
- **Problem** (observed): OBS-3 — the REGEX detector test matched all 6 expected patterns with correct offsets (`actualOutput.matched: true`) but the harness reported `status: FAIL`; the GLiNER test used the same subset-style expected-outcome shape and PASSed. The ledger's read: the comparator appears to require exact shape equality (e.g. confidence values) for some detector types but not others, and this is "misleading in exactly the way that makes people skip testing."
- **User impact**: A correctly-configured, verifiably-working detector reports FAIL, teaching users to distrust or ignore the test harness — the opposite of the harness's purpose, and inconsistent across detector types makes the failure mode unpredictable.
- **Proposed improvement**: Standardize the expected-outcome comparator to subset matching (matched values + offsets) across all detector types, and drop exact-equality requirements on volatile fields like confidence scores unless explicitly requested by the test author.
- **Expected benefit**: Test scenarios become a reliable pre-scan verification step across detector types instead of a source of false failures that erodes trust in testing.
- **Priority**: P1
- **Area**: detectors

---

## I-14 — Response amplification in detector test output
- **Problem** (observed): OBS-4 — every finding in a test response embeds the entire page's `extracted_data` entity dump; 6 findings for a 230-character input required truncation in the MCP response, i.e. response-size amplification visible even at the smallest possible input scale.
- **User impact**: Test-scenario responses scale poorly and get truncated even on trivial inputs, obscuring the actual test result behind redundant payload.
- **Proposed improvement**: Return each finding's own matched span/context only; reference the page's full entity dump once (or by id/link) rather than duplicating it per finding.
- **Expected benefit**: Shrinks response payloads proportionally to finding count, removing a needless truncation failure mode on the MCP transport.
- **Priority**: P2
- **Area**: detectors / MCP

---

## I-15 — Autopilot: notification/consent surface for config mutations
- **Problem** (observed): OBS-12 — autopilot silently mutated an operator-authored source config (disabled CREDIT_CARD pattern, authored and wired a new detector) minutes after the operator saved it. The ledger judges the change as evidence-defensible but notes "there is no notification/consent surface for 'the AI edited your source config.'" This is distinct from and compounds the G-005 gap (no MCP surface to see/control autopilot at all).
- **User impact**: An investigator's own configuration changes can be silently overwritten by an autonomous agent with no notification, which is confusing at best and could mask or reverse an intentional decision at worst — especially dangerous in an evidentiary context where configuration provenance may itself matter.
- **Proposed improvement**: Add an in-product notification (and ideally an opt-in consent gate) whenever autopilot mutates a source config, detector, or other operator-owned artifact — surfaced in both REST and MCP, referencing the specific change and its rationale (autopilot already records rationale in its memory entries, per the ledger).
- **Expected benefit**: Preserves operator trust and auditability when autonomous agents act on shared state; makes autopilot's (otherwise well-verified, per G-021) behavior visible rather than surprising.
- **Priority**: P1
- **Area**: autopilot

---

## I-16 — Fix autopilot memory timestamp timezone labeling
- **Problem** (observed): OBS-11 — autopilot memory `createdAt` values store local time with a trailing `Z` suffix as if UTC (e.g. `"19:19:40Z"` written at 17:19Z real time), a two-hour mislabeling in this run.
- **User impact**: Any timeline reconstruction or audit of autopilot's actions (relevant given OBS-12's consent concerns) will be off by the local UTC offset, producing incorrect chronologies.
- **Proposed improvement**: Fix the timestamp serialization in autopilot memory writes to either store true UTC or use a correctly-labeled offset, consistent with the rest of the system's timestamp handling.
- **Expected benefit**: Restores correctness of autopilot's audit trail, which matters directly for the consent/attribution concern raised in I-15.
- **Priority**: P2
- **Area**: autopilot

---

## I-17 — Rank findings/leads by evidence quality, not raw severity
- **Problem** (observed): "Every CRITICAL is a recognizer artifact" replicated across two different corpora in this test lineage: lay-k's 7 CREDIT_CARD findings (severity CRITICAL, confidence 1) were all suite-number+phone-number concatenations, i.e. false positives; separately, every California-scheme-name regex hit outside forney-j was a false positive (Star Wars server names, a Harley-Davidson prize, a wireless ISP), while the real market-manipulation signal came from the LLM detector, not the regex, despite comparable or lower nominal severity. OBS-6 additionally shows severity is a static schema default (all GLiNER entities HIGH) rather than an evidence-quality signal.
- **User impact**: An investigator triaging by severity alone will be routed first to a wall of high-confidence, high-severity noise, and only reach the substantive LLM-sourced findings (which carried richer evidence: matchedContent quotes, people_involved, rationale) after wading through recognizer artifacts.
- **Proposed improvement**: Introduce an evidence-quality signal independent of raw severity — factoring detector type (regex-without-context vs. LLM-with-rationale vs. entity-recognizer), presence of corroborating context (quotes, rationale fields), and historical false-positive rate for that detector/pattern — and make ranking surfaces (findings lists, case leads, inquiry matches) lead with evidence quality rather than severity alone.
- **Expected benefit**: Surfaces genuinely load-bearing findings (like the Forney ERCOT desk instructions, verified by grepping the original corpus) ahead of pattern-matching noise, directly addressing a failure mode that has now recurred across two independent first-use runs.
- **Priority**: P1
- **Area**: findings / cases

---

## I-18 — Documentation: correct API base path and route mounting
- **Problem** (observed): OBS-2 — the task brief specified API base `http://127.0.0.1:49937/api`, which is wrong; the NestJS app sets no global prefix, so routes live at root (`/ai-provider-configs` answers, `/api/ai-provider-configs` 404s), and only MCP is additionally mounted under `/api/mcp`. Cost: ~4 wasted probes in this run alone.
- **User impact**: Anyone following the documented REST fallback pattern wastes time on 404s before discovering the correct root-level routing.
- **Proposed improvement**: Correct the documented API base/path convention (and/or add a redirect or clear 404 message from `/api/*` pointing to the correct root path) so this doesn't recur across future onboarding or first-use runs.
- **Expected benefit**: Removes a small but repeatable friction cost that has now been hit and documented twice.
- **Priority**: P2
- **Area**: documentation

---

## I-19 — Fix validate_detector_config oneOf schema bug
- **Problem** (observed): G-001 CONFIRMED — `validate_detector_config` rejects a valid, bare REGEX pipeline schema with `data must match exactly one schema in oneOf`, even though `create_custom_detector` accepts the identical schema without issue.
- **User impact**: The validator is actively wrong on a common, correct input, teaching users (per the same pattern as OBS-3) to bypass or distrust validation before detector creation.
- **Proposed improvement**: Fix the `oneOf` schema branch matching in the detector-config validator so a bare REGEX pipeline is recognized as satisfying exactly one branch, consistent with what `create_custom_detector`'s own (evidently correct) validation accepts.
- **Expected benefit**: Restores validate-before-create as a trustworthy step, and removes a second, independent instance (alongside OBS-3) of the "harness says fail but the thing actually works" trust-eroding pattern in this test.
- **Priority**: P2
- **Area**: detectors

---

## I-20 — Fix search_sources totals mislabeling never-run sources as "running"
- **Problem** (observed): OBS-1 — `search_sources` totals block reported `{total:151, healthy:0, errors:0, running:151}` while every source was `PENDING` with `latestRunner: null` — no run had ever started.
- **User impact**: A dashboard/summary view that claims 151 sources are "running" when zero runs have ever occurred is actively misleading about system state at the moment an investigator most needs an accurate baseline.
- **Proposed improvement**: Correct the totals aggregation to count `PENDING`/never-run sources separately from `running`, matching the per-item `runnerStatus` already reported correctly.
- **Expected benefit**: Baseline/dashboard counts become trustworthy at a glance, without needing to cross-check individual source items to catch the mislabeling.
- **Priority**: P2
- **Area**: UI / API

