# Investigation Protocol — Enron Email Corpus, Second Validation Attempt

```
Build under test: Classifyre desktop v0.4.60 (app bundle CFBundleShortVersionString 0.4.60)
Namespace: "Eron Email No 2" (a5a864c5-3a8f-4d4b-881a-7822da4f3aea, schema ns_eron_email_no_2)
API base: http://localhost:9933 (NO /api prefix — task brief's "http://localhost:9933/api" is the
  Swagger docs route, not the API root; same doc error as run #1 → OBS-1)
MCP: http://localhost:9933/mcp
Embedded PG: host=127.0.0.1 port=54320 db=classifyre schema=ns_eron_email_no_2
Recorded: 2026-07-19 ~20:4x local
Operator: Claude (Fable 5) via MCP; REST fallback documented per-use. AI Autopilot ENABLED throughout
  (per brief — unlike run #1, where it was disabled mid-run for attribution).
```

## Prior-state notes (attribution hygiene)

- A **stale partial second attempt** exists in namespace `ns_eron_emails_second_trial`
  (v0.4.58, 2026-07-19 morning): 151 sources, 1,839 assets, 17,171 findings, 8 runners,
  2 detectors, no deliverables written. It is NOT this run. Left untouched; this run is
  namespace `ns_eron_email_no_2` only.
- Run #1 namespace `ns_eron_mail` still exists and its API/autopilot were observed active
  today (log lines at 20:17). Ignored except where it pollutes shared surfaces.

## Baseline (verified via MCP + DB, 2026-07-19 ~20:45)

- sources: 151 (LOCAL_FOLDER, one per account dir under enron_mail_git2/mail, sampling AUTOMATIC,
  **no detectors attached**, aiMode INHERIT) — disk has 156 account dirs; 5 not configured
  as sources (not yet identified; carried as a coverage question → OBS-4)
- assets/findings/runners/custom_detectors/inquiries/cases: all 0 (DB count)
- autopilot: instance-settings shows aiEnabled true, all agent kinds enabled
  (inquiry/case/config/detector/escalation), aiProviderConfigId 57e6b517-…

## Corpus change vs run #1 (from disk, minimal peek before operator redirect)

- The per-account `index*.json` email digests are GONE (0 remain). Corpus now 156 account
  dirs, 377,127 files, 11 GB, overwhelmingly `attachments/` binaries (.doc 187k, .xls 65k,
  .dat 25k, .pdf 23k, .ppt 19k …, .eml only 7,128).
- **Email bodies now exist only as .eml files in ~20 accounts** (guzman-m 3,044,
  linder-e 2,163, merris-s 1,044, symes-k 716, kean-s 32, dasovich-j 30, …). Most accounts
  (e.g. allen-p, forney-j) contain ONLY attachments.
- **Corpus integrity hazard (OBS-2):** many attachment files are not real content:
  131-byte **git-lfs pointer stubs** (`version https://git-lfs.github.com/spec/v1 …`) and
  ~173-byte `Attachment f:\attachcus\…` placeholder stubs. Observed concretely: the same
  filename real in shively-h but an LFS stub in zipper-a/martin-t/neal-s. Any coverage or
  finding claims must be read against this.
- D-note: operator redirected the run to explore **through Classifyre** (RANDOM sampling runs,
  asset/finding exploration, detector iteration) rather than profiling the raw corpus further.
  Recorded as D-1 (strategy decision).

## Observation ledger

| # | Status | Observation |
|---|---|---|
| OBS-1 | GAP (doc) | API root has no `/api` prefix; brief again points at Swagger path. |
| OBS-2 | RISK (corpus) | LFS pointer stubs + `Attachment f:\` placeholders inside attachments dirs; ingestion will "scan" 131-byte pointer text as file content. Run #1 ns logs show exactly that (`snippet: version https://git-lfs.github.com/spec/v1`). |
| OBS-3 | GAP (UX) | `search_sources` totals for a never-run instance report `{healthy:0, errors:0, running:151}` — PENDING (never run) is counted as "running". Misleading dashboard number. |
| OBS-4 | OPEN | 151 sources vs 156 account dirs on disk — which 5 accounts were not configured, and why, not yet determined. |
| OBS-5 | FAIL (product judgment, repeat) | All 3 CRITICAL findings in the first probe are `UK_NHS` recognizer hits on US phone numbers ("877-305-3759", "215 245-4707") and a timestamp ("2001041403"), confidence 1.0. Run #1's "every CRITICAL is a recognizer artifact" replicated on a different recognizer. New `evidenceAnalysis` ranking marks severity "neutral" but still scores such an FP importance 0.856 ("unique evidence"). |
| OBS-6 | RISK | Asset created during a run (createdAt inside run window) carries `status: "UNCHANGED"` in get_asset while the runner correctly reports assetsCreated=100. Counter fixed (B-4 PASS at runner level), but asset-level status is misleading for first-seen assets. |
| OBS-7 | **FAIL (confirmed bug, new)** | **Autopilot cross-namespace leakage.** In fresh `ns_eron_email_no_2`, `GET /autopilot/runs` shows a full agent cycle (INQUIRY/CASE/CONFIG/DETECTOR_AUTHOR/ESCALATION) for runner `5ec2ae35` / source `0b628215` = **`source_zipper-a` of `ns_eron_mail`** (run #1's namespace). Rows physically persisted in `ns_eron_email_no_2.agent_runs` (DB-verified); MCP `get_run`/`get_source` in this namespace 404 on those IDs. Impact so far read-only ("0 applied; N read" each; CONFIG "1 failed"), but agent cycles execute against foreign scan events and pollute this namespace's provenance. |
| OBS-8 | PASS/GAP | RANDOM sampling on LOCAL_FOLDER selects 100 objects/run (= `rows_per_page` default, documented "tabular only" — G-002 confirmed). guzman-m probe: 100 assets, 76.5 s, PII-only ≈ 0.77 s/asset. `assetsCreated: 100` on first run — **B-4 counter regression FIXED at runner level** (provisional). |
| OBS-9 | PASS | DUPLICATES worker ran on the probe run: 2 decisions APPLIED, cluster maintenance, rationale strings match payload; summary matches persisted decisions. |
| OBS-10 | PASS (run honesty) | allen-p probe ended **WARNING** with `textCoverage {extracted:93, empty:4, failed:1, notApplicable:2}` and errorMessage naming the failure count. Root cause verified: one genuinely corrupt 16 KB .xls (`merit2001.xls`) that LibreOffice could not load; failure surfaced without failing run or asset. Honest-run surfaces WORK in the field. |
| OBS-11 | PASS (B-5 FIXED) | Semantic stack alive on desktop: `/embeddings/status` (REST-only) reports transformers-js MiniLM 384-d, workerRegistered, embeddedRows 5,596, pendingEmbedJobs 8,753, 0 failures; DB shows content_embeddings rows growing. Vector-mode `search_assets` returns ranked, thematically plausible results ("West position1006.xls" top-5 for a positions query). Coverage partial while queue drains (vector total 176 of 435 chunked assets). |
| OBS-12 | GAP (semantic UX) | Semantic search results carry **no matched snippet, chunk reference, or per-result score** — relevance cannot be judged or verified from the product's own output; only the ranking mode is echoed. |
| OBS-13 | PASS w/ defects (B-1 FIXED) | LLM detector test path now executes the model (deepseek call, quote/rationale extracted, conf 0.99, 8–37 s/scenario). Defects: (a) MCP tool description documents expected_outcome shape `{classification:{task:{label,confidence}}}` that the comparator never reads — it wants flat `{label, minConfidence}`; (b) comparator normalizes finding_type underscores→spaces so the expected label must be "market gaming instruction" not the label's actual name — undocumented; (c) FAIL results carry no expected-vs-actual diff; (d) every run re-runs all scenarios (3 LLM calls to test 1 change), and scenarios cannot be deleted via MCP (G-010 unchanged). |
| OBS-14 | GAP (G-001 unchanged) | `validate_detector_config` still rejects a valid bare REGEX schema ("must match exactly one schema in oneOf"). Creation works. |
| OBS-15 | **FAIL (confirmed bug, headline)** | **Custom LLM detector silently fails at scan scale.** guzman-m run `e7ef603a` (PII+FERC+LLM, 4-pool): **0 of 100** LLM calls succeeded — 297 provider 503/429s ("ResourceExhausted: Worker local total request limit reached (186/48)"). CLI `_llm._complete_and_parse` catches every exception and `return []` (line 147-155), so per-asset `detector_outcomes` records email-conduct-screen **OK on 98 assets** and the run is **COMPLETED** with **zero LLM findings** — indistinguishable from "found nothing." Same honest-run failure class as run #1 G-014, now for custom LLM detectors under concurrency. |
| OBS-16 | **FAIL (confirmed bug)** | **LLM detector double-listed per asset.** 90/100 scan lines read `[pii, FERC Docket References, Email Conduct Screen, Email Conduct Screen]` — the one LLM detector runs **twice** per asset (2× cost, 2× rate-limit pressure). Recipe carried a single `custom_detectors:[ferc,llm]`; the double appears in pipeline `all_active = text + binary(+link)` list assembly (`detector_pipeline.py:163`), likely because the LLM detector's supported-content-types put it in both buckets. |
| OBS-17 | GAP (recurrence) | FERC-docket regex produced **0 findings** on guzman-m and haedicke-m RANDOM samples — dockets absent from the sampled slice (not a detector defect; RANDOM's seed-0 determinism, G-003, means re-runs sample the same 100). The clean cross-document recurrence signal both runs relied on needs either ALL scope or a term that actually recurs. |
| OBS-18 | PASS/GAP (autopilot) | Autopilot provenance **improved**: inquiries carry `createdBy: ai-autopilot`, decisions (`agent_decisions`) match summary strings, memories tagged pending-verification. Quality mixed: 2/4 inquiries investigation-grade (FERC/Bracewell regulators; Tenaska/Kinder Morgan/Transwestern counterparties), 2/4 noise ("Seller", "University", "Grand Total"). It **silently enabled SECRETS on my allen-p source and triggered its own rescan** (CONFIG agent, `TUNE_SOURCE`+`TRIGGER_SCAN`, 19:01) — same consent gap as run #1. |
| OBS-19 | FAIL (probable bug) | Autopilot **CASE agent failed twice** with `OpenAI model not found (404 no body)` (18:37, 18:43) while INQUIRY/DETECTOR/my-LLM-detector used the same provider fine — agent-layer model-name misconfig; intermittent (a later CASE run COMPLETED). |
| OBS-20 | PASS (G-026 fix holds) | Reviewing a superseded runner: `assets.profile` returns runnerSuperseded + live sourceTotals (verified in autopilot memory writes — no false "0 assets" profiles this run). |
| OBS-21 | **FAIL (confirmed bug, headline autopilot)** | **Autopilot silently overwrites operator detector config (last-writer-wins race).** Timeline: 19:12:36 I set guzman-m to LLM-only + `resources.max_pool_workers:1` (verified in update_source response); 19:12:40 I triggered run `9a13f466`; **19:12:49 autopilot CONFIG agent `TUNE_SOURCE` "enable SECRETS"** using a stale pre-edit base → clobbered my LLM selection; 19:13:03 autopilot `TRIGGER_SCAN`. My run (queued, startedAt 19:13:36) then executed the autopilot's recipe **PII + SECRETS** (run log: `Initialized detector: pii, secrets`; 0 LLM lines). Net: the operator's just-saved detector set was silently replaced by the agent, and the operator's own manual run executed the agent's config. No consent surface, no conflict detection. Also invalidated my LLM-throttle test (below). |
| OBS-22 | FAIL (confirmed, throttle retry `9b5eb3b9`) | First throttle test invalidated by OBS-21 hijack (ran SECRETS, not LLM). **Retry (won the race, LLM-only, workers=1, 100 assets, 483 s):** LLM errors fell 297→**26** vs the 4-pool run, but `detector_outcomes` **still reports email-conduct-screen OK on 98 assets** and findingsCreated=0. Conclusion: throttling reduces error *volume* but the **silent-failure/error-swallowing (BUG A) is independent of concurrency** — a rate-limited LLM detector always reports OK. LLM double-listing (BUG B) persisted even single-worker. |
| OBS-23 | PASS (G-021 FIX HOLDS) | Run `9a13f466` changed the detector set on a populated source (LLM/PII/FERC → PII/SECRETS) yet reported **findingsResolved: 0, findingsRetained: 4501** — the other detectors' prior findings stayed OPEN, scoped resolution held. |
| OBS-24 | PASS (FP preservation) | My manually-marked FALSE_POSITIVE (finding `b8d1ff1b`, UK_NHS-on-phone-number) **survived the detector-set-change rescan**: status still FALSE_POSITIVE, same finding ID, history shows DETECTED→STATUS_CHANGED intact. Triage durability confirmed in the field. |

## Production action ledger

| When | Interface | Action | Result |
|---|---|---|---|
| 20:40 | REST GET /instance-settings | probe API root | 200; aiEnabled+mcpEnabled true (root, not /api → OBS-1) |
| 20:45 | MCP search_sources / list_custom_detectors | baseline | 151 sources PENDING; 0 detectors |
| 20:45 | DB | baseline counts ns_eron_email_no_2 | all-zero except sources=151 |

## Phase log

### Phase 1 — RANDOM probe runs (in progress)

Probe set (RANDOM sampling + built-in PII only, chosen for diversity and to avoid run #1's
deep targets): guzman-m (richest .eml), haedicke-m (legal dept), allen-p (attachments-only
classic), germany-c, kaminski-v (research, large). All updated via MCP `update_source`,
runs started via `start_source_run` (triggeredBy `fable-second-attempt`).

- 20:32 guzman-m run `9a23914d`: COMPLETED 76.5 s, 100 assets, 4,501 findings, 1 assetWithoutText.
  Sampled assets are real RFC-822 emails (`attachments/*_$RFC822.eml`, mime message/rfc822) +
  spreadsheets ("West position1006.xls", 257 findings, 215 DATE_TIME). PII default entity set is
  broad (ORGANIZATION 1.8k+, DATE_TIME, PERSON, LOCATION, EMAIL_ADDRESS, NRP, URL, IP, UK_NHS).
  ORGANIZATION quality mixed: real orgs (Sunoco, ENERconnect) + junk spans ("Definitive
  Agreement", newline-glued "Paul DeVries\nCommencing…").
- 20:33 haedicke/allen/germany/kaminski runs started (`b8e6674a`, `907d48ec`, `8d33e871`, `6a957e5c`).
- Autopilot observed active (REST /autopilot/runs — MCP gap G-005 unchanged): legitimate
  DUPLICATES on guzman runner + the OBS-7 cross-namespace cycle. `GET /autopilot/status` 404
  (endpoint from run #1 docs does not exist on this build; agents list is elsewhere).

### Phase 2 — Detector iteration & regression checks (complete)

- Created 2 detectors: `ferc-dockets` (REGEX, exact FERC docket ids) and `email-conduct-screen`
  (LLM, deepseek-v4-flash, 4 conduct labels, quote/people/rationale output, no catch-all).
- `validate_detector_config` rejected the valid REGEX schema (G-001 persists); created directly.
- LLM detector test: model executes (B-1 FIXED); comparator needs undocumented flat, space-normalized
  label shape (BUG C) — PASS achieved with `{label:"market gaming instruction", minConfidence:0.5}`.
- Iteration run guzman `e7ef603a` (PII+FERC+LLM, 4-pool): **LLM silently failed** — 297 provider
  503/429, swallowed to `OK`, 0 LLM findings (BUG A/OBS-15); LLM double-listed 90/100 (BUG B/OBS-16).
- FERC regex: 0 findings on sampled slice (OBS-17).
- Throttle test (workers=1): **hijacked by autopilot** (BUG F/OBS-21) — ran PII+SECRETS not LLM.
- Throttle retry `9b5eb3b9` (workers=1, LLM-only, won the race): recipe = `custom` (LLM), still
  double-listed. Mid-flight ~35% of calls still 503/errored and swallowed → error-swallowing is
  **independent of concurrency** (throttling reduces volume, does not fix the silent-failure bug).
  Routine guzman emails legitimately yield no conduct labels → 0 findings. **Conclusion: the LLM
  conduct tier is not usable across the corpus on this build.**

### Phase 3 — Investigation, lifecycle, autopilot (complete)

- Case 1 `db602e37` (California FERC/legal thread) built from verified cross-custodian ORGANIZATION
  recurrence; 5 findings attached, 1 chronology event, linked to autopilot inquiry `f99c63cb`.
  Extraction fidelity verified verbatim against source .doc.
- Lifecycle: G-021 **HOLDS** (OBS-23), FP-status preservation **HOLDS** (OBS-24).
- Autopilot audited against persisted state — see `autopilot-evaluation.md`. Provenance improved;
  BUG D (cross-namespace leak), BUG F (config hijack), BUG E (CASE 404) found.

## Regression classification (first-attempt issues re-tested)

| First-attempt issue | Classification | Evidence |
|---|---|---|
| B-5 semantic stack dead on desktop | **FIXED** | /embeddings/status healthy, embeddedRows grow, vector search real (OBS-11) |
| B-4 / G-012 / G-020 first-run counters | **FIXED** | assetsCreated:100 on first run (OBS-8) |
| B-1 LLM detector test silent no-op | **FIXED** | test path executes model, conf 0.99 (OBS-13) |
| G-014 crashed detector reports success | **NOT FIXED (recurs for LLM)** | LLM 503s swallowed to detector_outcomes OK (OBS-15/BUG A) |
| G-021 finding preservation on detector-set change | **FIXED / HOLDS** | findingsResolved:0, retained:4501 (OBS-23) |
| FP-status preservation across rescan | **FIXED / HOLDS** | FP mark + ID survived (OBS-24) |
| Run honesty (WARNING/textCoverage/detector_outcomes) | **FIXED / HOLDS** | corrupt-xls WARNING correct (OBS-10) |
| Email-level evidence traceability | **FIXED (via 1-file-1-asset)** | each .eml/attachment a separate asset (OBS/cases) |
| Large-mailbox granularity | **FIXED (corpus + product)** | no mailbox-sized assets; index.json gone |
| Severity ≠ evidence quality | **NOT FIXED** | every CRITICAL a UK_NHS-on-phone artifact (OBS-5) |
| Autopilot silently mutates operator config (OBS-12) | **NOT FIXED / WORSE** | now a concurrent-edit race that clobbers a just-saved config (OBS-21/BUG F) |
| G-005 no autopilot MCP tools | **NOT FIXED** | all autopilot obs via REST/DB |
| G-002 rows_per_page tabular-only / G-003 seed-0 RANDOM | **NOT FIXED** | RANDOM caps 100, same 100 each run |
| G-001 validate_detector_config rejects valid schema | **NOT FIXED** | REGEX schema rejected (OBS-14) |
| G-010 no MCP delete for test scenarios | **NOT FIXED** | unchanged |
| Cross-namespace autopilot isolation | **NEW BUG (BUG D)** | foreign agent cycle persisted in fresh namespace (OBS-7) |
| Autopilot CASE agent model config | **NEW BUG (BUG E)** | CASE 404 "model not found" ×2 (OBS-19) |
| LLM detector double-execution | **NEW BUG (BUG B)** | listed twice per asset (OBS-16) |
| Detector-test comparator shape mismatch | **NEW BUG (BUG C)** | documented nested shape always FAILs (OBS-13) |

## Close-out

The build fixes the first attempt's structural failures (semantic, counters, honesty, lifecycle,
granularity) and clears its bar. It does **not** fix judgment: severity is still artifact-driven, the
LLM conduct tier silently fails at scale (the single most important negative finding), and the
autopilot escalated from "silently edits config" to "overwrites a just-saved config in a race and runs
its own recipe on your run." One verified, independent case (California FERC/legal thread) was built.
See `product-evaluation.md` for the argument, `bugs.md`/`improvements.md` for the fix list,
`autopilot-evaluation.md` for the agent audit, `cases-and-findings.md` for the evidence, and
`classifyre-enron-second-validation.md` for the narrative.

### Phase 0 — Baseline (complete)

As above. Strategy decision D-1: operator-directed — iterate with RANDOM sampling probe runs across
diverse sources, explore assets/findings, iterate detector set, and only then commit an ALL-strategy
scan on a justified slice.
