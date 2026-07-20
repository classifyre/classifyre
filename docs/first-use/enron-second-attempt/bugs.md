# Classifyre Desktop v0.4.60 — Bugs and Defects (Enron Second Attempt)

Build/env: Classifyre desktop **v0.4.60**, namespace `ns_eron_email_no_2`, API `http://localhost:9933` (no `/api` prefix — `/api` is Swagger only). Embedded Postgres port 54320, schema `ns_eron_email_no_2`. Corpus: 151 LOCAL_FOLDER sources (one per Enron mailbox) at `/Users/.../enron_mail_git2/mail`. AI Autopilot enabled throughout. LLM provider: `deepseek-ai/deepseek-v4-flash` via an OpenAI-compatible NVIDIA endpoint (`aiProviderConfigId 57e6b517-...`).

This is the **second** Enron-corpus smoke test. The first attempt's docs live in `docs/first-use/enron/` (bugs.md, improvements.md, etc.), against v0.4.57. Where a finding here matches a first-attempt bug, status is called out explicitly (regression / same class / unrelated-new).

Everything below traces only to evidence supplied for this run. Nothing here is invented.

---

## Confirmed bugs

### BUG A — Custom LLM detector silently fails at scan scale (HEADLINE)
- **Severity**: High
- **Status**: CONFIRMED
- **Component**: CLI detector runtime / run-honesty (`detector_outcomes`)
- **Repro**: guzman-m run `e7ef603a`, detectors PII + FERC-regex + LLM `email-conduct-screen`, default 4-worker pool, 100 assets.
- **Observed**: 0 of 100 LLM calls succeeded. Runner-log NDJSON shows 297 provider errors — HTTP 503 `ResourceExhausted: Worker local total request limit reached (186/48)` and 429 `RateLimitError`. Root cause in `apps/cli/src/detectors/custom/runners/_llm.py`, `_complete_and_parse` (lines ~147–155): every exception is caught and the function returns `[]` (empty result) with no error propagated.
- **Consequence**: Per-asset `detector_outcomes` recorded `email-conduct-screen` status `OK` on 98 assets; the run finished status `COMPLETED`; zero LLM findings were produced — indistinguishable in the UI/API from "genuinely found nothing."
- **Relation to first attempt**: Same failure **class** as first-attempt **G-014** (crashed detector reported success), now specifically hitting custom LLM detectors under provider concurrency. Treat as a recurrence of the underlying pattern, not a literal regression of a fixed bug.
- **Fix requirements**: (a) surface provider errors into `detector_outcomes` as `ERROR`/`WARNING`, never `OK`; (b) throttle detector concurrency / respect provider rate limits with backoff instead of hammering the endpoint past its own advertised limit (186 requests against a 48 limit).

### BUG B — LLM detector double-execution
- **Severity**: Medium
- **Status**: CONFIRMED
- **Component**: CLI pipeline detector assembly
- **Repro**: Same guzman-m run `e7ef603a`.
- **Observed**: 90 of 100 `[pool] Scanning <asset> [pii, FERC Docket References, Email Conduct Screen, Email Conduct Screen]` log lines list the single configured LLM detector **twice**. The one LLM detector ran twice per asset — 2x LLM cost, 2x rate-limit pressure, directly compounding BUG A.
- **Root cause**: `apps/cli/src/pipeline/detector_pipeline.py` (~line 163) assembles `all_active = text_detectors + binary_detectors + link_detectors`. The LLM detector's `get_supported_content_types` (`apps/cli/src/detectors/custom/runners/_llm.py` ~line 162) returns text types plus vision types, so it lands in more than one bucket with no dedup.
- **Relation to first attempt**: New — not previously observed.

### BUG C — Detector-test comparator/label mismatch (usability → correctness)
- **Severity**: Medium
- **Status**: CONFIRMED
- **Component**: MCP tool schema/docs / API comparator (`apps/api/src/custom-detector-tests.service.ts`)
- **Observed**:
  - The MCP `create_detector_test_scenario` tool documents `expected_outcome` as the nested shape `{classification:{task:{label,confidence}}}`, but the server comparator (`compareOutcome`, ~lines 360–416) only reads the FLAT shape `{label, minConfidence}` for LLM/GLiNER detectors. Using the documented nested shape always yields `FAIL`, even when the detector fires correctly.
  - The comparator normalizes `finding_type` underscores → spaces, so to match a label whose real name is `market_gaming_instruction`, `expected_outcome.label` must be written `"market gaming instruction"` — undocumented.
  - Net effect verified directly: an LLM detector that works perfectly (confirmed returning the correct label at confidence 0.99, with quote+rationale populated) shows test status `FAIL` until the comparator's undocumented shape/normalization is reverse-engineered.
  - Additional related issues in the same path: `FAIL` results show no expected-vs-actual diff; every test run re-runs ALL scenarios (N LLM calls per test run, no selective re-run); scenarios cannot be deleted via MCP.
- **Relation to first attempt**: The scenario-delete gap is unchanged from first-attempt **G-010**. The rest (nested/flat schema mismatch, label normalization, missing diff) is new.

### BUG D — Autopilot cross-namespace leakage (NEW)
- **Severity**: Medium-High
- **Status**: CONFIRMED
- **Component**: Autopilot scheduling / namespace isolation
- **Observed**: In the fresh namespace `ns_eron_email_no_2`, `GET /autopilot/runs` and the DB table `ns_eron_email_no_2.agent_runs` contain a full agent cycle (INQUIRY / CASE / CONFIG / DETECTOR_AUTHOR / ESCALATION) whose `sourceId 0b628215-...` and `runnerId 5ec2ae35-...` belong to a **different** namespace (`ns_eron_mail`'s `source_zipper-a`, from the first attempt). MCP `get_run`/`get_source` in this namespace correctly 404 on those IDs, but the agent rows are physically persisted in this namespace's tables, and agent cycles executed against scan-completed events from a namespace they don't belong to.
- **Impact**: This particular run was read-only (each agent logged "0 applied; N read"), so no cross-namespace writes occurred — but it pollutes this namespace's provenance and demonstrates agents can fire on events sourced from other namespaces.
- **Relation to first attempt**: New — not previously observed (first attempt only had a single namespace to test against).

### BUG F — Autopilot silently overwrites operator detector config (last-writer-wins race) (NEW, HEADLINE)
- **Severity**: High
- **Status**: CONFIRMED
- **Component**: Autopilot CONFIG agent / source-config concurrency control
- **Repro / timeline** (guzman-m, source `68a1dcdd-...`):
  - `19:12:36` operator `update_source` → detectors `[CUSTOM email-conduct-screen]`, `resources.max_pool_workers:1` (confirmed in the update_source response).
  - `19:12:40` operator `start_source_run` → `9a13f466` (queued PENDING).
  - `19:12:49` autopilot CONFIG agent `TUNE_SOURCE` APPLIED, rationale "Enable SECRETS detector for the email dataset…" — written from a **stale pre-edit base**, clobbering the operator's just-saved LLM-only selection.
  - `19:13:03` autopilot `TRIGGER_SCAN` APPLIED.
  - `19:13:36` operator's own run *starts* and executes the autopilot's recipe **PII + SECRETS** (run log `Initialized detector: pii, secrets`; zero LLM lines).
- **Consequence**: An operator's just-saved detector set was silently replaced by the agent within ~13 seconds, with no conflict detection, no consent surface, and no notification. The operator's manually triggered run then executed the agent's configuration instead of the operator's. It also invalidated a controlled LLM-throttle experiment (the LLM detector never ran).
- **Relation to first attempt**: Related to first-attempt OBS-12 (autopilot silently mutated an operator source config), but stronger: here it is a **concurrent-edit race** that overwrites a change made seconds earlier, not just an edit to a settled config.
- **Fix requirements**: (a) optimistic concurrency / version check on source config so an agent write cannot silently clobber a newer operator write; (b) a consent or at least a notification surface for autopilot config mutations; (c) MCP visibility into pending/last autopilot config changes.

---

## Probable bugs

### BUG E — Autopilot CASE agent intermittent 404 (NEW)
- **Severity**: Medium
- **Status**: PROBABLE
- **Component**: Autopilot CASE agent LLM config
- **Observed**: Two CASE agent runs FAILED with error `"OpenAI model not found. (404 status code (no body))"` (`agent_runs` at 18:37 and 18:43), while INQUIRY/DETECTOR_AUTHOR agents and the operator's own LLM detector succeeded on the same provider in the same window. A later CASE run COMPLETED normally.
- **Hypothesis**: Intermittent or agent-specific model-name/routing misconfiguration scoped to the CASE agent specifically, not a provider-wide outage (other agent kinds and the manual detector worked throughout).
- **Relation to first attempt**: New.

---

## Product-judgment issues (not crashes; confirmed observations)

| Observation | Detail |
|---|---|
| Severity ≠ evidence quality, REPLICATED | Every CRITICAL finding in this probe was a UK_NHS recognizer hit on US phone numbers (`877-305-3759`, `215 245-4707`) and a bare timestamp, all confidence 1.0. First attempt: every CRITICAL was CREDIT_CARD on phone/OCR artifacts — same lesson, different recognizer. The new evidenceAnalysis ranking correctly labels severity "neutral" but still scored the FP importance 0.856 ("unique evidence"). |
| Built-in PII ORGANIZATION extraction is noisy | Real orgs (Sunoco, ENERconnect, FERC, Bracewell & Patterson) mixed with junk spans ("Definitive Agreement", "Grand Total", newline-glued "Paul DeVries\nCommencing on Ontario Market Opening"). Recall decent, precision low; needs review before use. |
| Semantic search returns no verifiable evidence | No snippet/chunk-ref/score is returned per result (only the ranking mode is echoed back). An investigator cannot judge or verify relevance from the product's own output. Usability gap. |
| RANDOM sampling capped and deterministic | LOCAL_FOLDER RANDOM sampling is capped at 100 objects (= `rows_per_page` default, documented "tabular only" — first-attempt **G-002**) and is seed-0 deterministic (first-attempt **G-003**), so re-runs sample the same 100 files. |
| Misleading asset status on first sighting | Asset created during its first run shows `get_asset` status `"UNCHANGED"`, while the runner correctly reports `assetsCreated: N`. Misleading asset-level status for first-seen assets. |

---

## Fixed-since-first-attempt (regression watch results)

| First-attempt ID | Area | Second-attempt result |
|---|---|---|
| B-4 / G-012 / G-020 (assetsCreated=0 on first run) | Counters | **FIXED.** guzman-m first run reported `assetsCreated: 100` correctly. |
| Run honesty | Run status/error surfacing | **WORKS.** allen-p run ended `WARNING` with `textCoverage {extracted:93, empty:4, failed:1, notApplicable:2}` and an `errorMessage` naming the failure — root cause was one genuinely corrupt 16KB `.xls` LibreOffice couldn't load. Failure surfaced without failing the run or asset. |
| B-5 (semantic stack non-functional on desktop) | Semantics | **FIXED.** `/embeddings/status` reports transformers-js MiniLM-L6-v2 384-d, `workerRegistered: true`, `embeddedRows` growing (5,596), `pendingEmbedJobs` draining, 0 failures. Vector-mode search returns ranked, plausible results. |
| B-1 (LLM detector test path silent no-op) | Detector tests | **FIXED (execution).** The LLM detector test path now actually executes the model — deepseek call runs, quote/rationale extracted, confidence 0.99. (Note: a *different* test-path bug now exists — see BUG C above, comparator shape mismatch causes false `FAIL`.) |
| G-021 (finding preservation across detector-set change) | Findings lifecycle | **FIXED / HOLDS.** Run `9a13f466` changed the detector set on a populated source (LLM/PII/FERC → PII/SECRETS) and reported `findingsResolved: 0, findingsRetained: 4501` — the other detectors' prior findings stayed OPEN. |
| FP preservation across rescan | Findings lifecycle | **FIXED / HOLDS.** A manually-marked `FALSE_POSITIVE` (finding `b8d1ff1b`, UK_NHS-on-phone) survived a detector-set-change rescan: same finding ID, status still FALSE_POSITIVE, history DETECTED→STATUS_CHANGED intact. |

Other things that worked in this run (not regression-watch items, but relevant context):
- DUPLICATES autopilot worker: decisions APPLIED match summaries; provenance recorded in `agent_decisions`.
- Autopilot provenance improved generally: inquiries carry `createdBy: "ai-autopilot"`; `agent_decisions` rows match summary strings; memories tagged pending-verification.
