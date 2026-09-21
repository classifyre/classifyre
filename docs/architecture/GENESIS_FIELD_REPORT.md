# Field report: three GENESIS namespaces built on the dev instance

**Status:** 22 of 22 addressed and merged (P17–P20 in `119eb354`, `35d7e292`, `ff7e35f5`; P21–P22 in `98534f5d`, `4b60785b`; P1 and P14 partly), 0 open · **Reviewed:** 2026-09-21, journal §17 — the corpus exercises ingestion and casework but not the detection engine · **Observed:** 2026-09-17, re-checked 2026-09-19 and 2026-09-20 on v0.5.9 · **Instance:** local k3d/skaffold
(`classifyre-dev`, API via port-forward `:8811`) · **Namespaces:** `de-statistik-integritaet`,
`de-regionen`, `de-fruehwarnung` · **Companion:** `genesis/PRODUCTIONISATION_JOURNAL.md`

The German statistics POCs (`genesis/`) were turned into three living namespaces through the REST
API only (MCP was not available): 20 CUSTOM notebook sources, 68 detectors (67 TAG + 1 REGEX), 34 inquiries
and 21 cases built on them. This report lists what the platform got in the way of, ranked by what it cost.
Everything below was reproduced on the instance; each item names the evidence and the code.

## Status (2026-09-20)

Fixed in the working tree and verified on the hot-reloading dev instance: the API runs `bun --watch` on the host
mount, and CLI jobs mount `apps/cli/src`. `genesis/classifyre/verify_platform_fixes.py` builds a throwaway
namespace and checks P1, P2, P4, P7, P8, P9, P15, P16, the inquiry notification and the §14 retirement rule end to
end (**19 of 19 passed**, `genesis/classifyre/logs/verify_platform_fixes-20260920.txt`).
Tests: full API suite 2,268 / 2,268 and full CLI suite 2,158 passed (17 skipped), after all changes.

The third pass (2026-09-20) closed the five that were left open, plus the §14 operational note. Four database
migrations ship with it — `RunnerStatus.STOPPED`, `assets.absent_under_scope`, `sources.connection_test` and an
index on `runners.started_at` — applied and confirmed on all 12 tenant schemas of the dev instance.

A fourth pass (2026-09-20, later the same day) closed the truncated-log bug that the third pass had recorded as
unfixed, and added two defects found while answering "why are the namespaces stale?": P17 and P19 below.
`verify_platform_fixes.py` still passes 19 of 19 (`logs/verify-20260920.txt`).

| # | Status | Change | Verified |
|---|---|---|---|
| P1 | **partly fixed** | the cross-namespace queue is no longer global FIFO. `NamespaceRegistryService.findNextPendingRunner` picks by lane, then by the namespace served longest ago (`preferQueued`, `runner-fair-queue.spec.ts`): a MANUAL run and a source's first run go ahead of scheduled sweeps, and a namespace that just had a slot goes to the back however quickly it re-enqueues — which is what let one tenant's `CATCH_UP` sweep hold every slot. `GET /runners/{id}/queue-position` answers the third ask (position, lane, running count, instance cap). **Not done:** the wall-clock budget for AUTO sweeps. The report assumed "its cursor already makes resumption safe"; it does not — `samplingCursor` is only persisted at finalize, so a run yielded part-way loses its sweep position and would re-do the ground. That needs mid-run cursor checkpointing in the CLI first | specs (5 fairness cases); live: `queue-position` returns lane + cap |
| P2 | **fixed** | the resource profile as before, plus the asynchronous endpoint: `POST /sources/{id}/test/async` returns 202 immediately and `GET /sources/{id}/test` carries the answer. The result lives on `sources.connection_test`, not in API memory, so a poll landing on another replica — or after a restart — still finds it; a second start joins the test already running, and one with no answer after 15 minutes is reported lost rather than left spinning | specs (7); live: **202 in 70 ms** for a test that took 18 s, answering *"modifieddata reachable: 20 updates in the last 7 days"* |
| P3 | **fixed** | `utils/cli-test-output.ts` finds the last complete (multi-line) JSON result among log lines; used by the Kubernetes test path | spec (5); live: the connector's own message is returned |
| P4 | **fixed** | CLI: a CUSTOM source declares its tag set complete (`asserts_complete_tags`); the pipeline records an OK outcome for every hydrated Tag detector whose key is absent, so the API's resolution retires the withdrawn finding | pytest (3 pipeline + 1 source); live: RESOLVED "Detection no longer present in scan" |
| P5 | **fixed** | SDK `ctx.query_assets(..., cohort=False)` for input-only reads; default unchanged | pytest; live on *GENESIS Länderwirtschaft* |
| P6 | **fixed (platform + config)** | `tag_*` labels are no longer phonetic-eligible; the GENESIS namespaces set every Tag and REGEX label's correlation weight to 0 (`deploy.py --only correlation`). Applying that exposed three more defects, all fixed: (1) `PUT /correlation/config`, `POST`/`DELETE /correlation/exclusions` and the MCP `save_correlation_config` / `add_`/`remove_correlation_exclusion` tools promised a recompute and never scheduled one (`saveConfig` leaves scheduling to its caller, and no caller did); (2) an *exact* value-set match forced DUPLICATE even when every shared value was weighted 0 — 1,928 pairs at 0 % confidence; (3) a full recompute never rebuilt the review queue, so it kept serving 20,506 pairs the new weights had removed. The umlaut-stripping label key is left alone: changing it would re-key existing correlation data | specs (value-normalizer, scoring, controller, recompute); live: 0 scored duplicate/related pairs; review queue 7,771 / 20,506 / 2,078 → 2,444 / 4,365 / 0 (the rest is near-duplicate template text, an operator decision) |
| P7 | **fixed** | `findings/stats` carries an `info` key on both the rollup and live paths, and the Findings page has a sixth tile. The invariant the four tiles broke — the severity keys summing to `total` — is now a test | spec; live: `de-statistik-integritaet` 1,176 total = 0+18+252+299+**607**, and the UI shows *Routine 607* |
| P8 | **fixed** | `RunnerStatus.STOPPED` exists (migration `20260920120000`, applied to all 12 tenant schemas), with its own label and a set-aside tone in the UI. The scheduler still reads a pre-STOPPED stop by its message. Fixing the status exposed a race the old ERROR-over-ERROR hid: tearing the execution down makes the watcher report "the Job is not found", and `failRunner` wrote that over the stop and charged a consecutive failure — so the stop is now claimed before any teardown begins | specs; live: `status=STOPPED`, `errorMessage=Manually stopped`, `consecutiveFailures=0` |
| P9 | **fixed** | `Tag(value, severity=)` in the notebook SDK. The detector's severity is a *ceiling*, not a default: a connector may lower a single assertion within it and may not promote past it. A refused promotion is recorded on the finding (`tag_severity_requested`) as well as warned about, so one detector covers *HIGH at +30%, MEDIUM at +20%* instead of two with duplicated descriptions | pytest (11); live: `+22%` → LOW under a HIGH detector, `+80%` asking CRITICAL → HIGH with `tag_severity_requested: CRITICAL`. **Applied 2026-09-21:** the platform fix shipped in the third pass but nothing used it — `de_land_alert_insolvencies_3m_yoy_high` and `…_yoy` were still two detectors and *Insolvenzsprünge* still named both. The Monatsindikatoren notebook now writes `Tag(value, severity="HIGH"|"MEDIUM")` under one key with a HIGH ceiling |
| P10 | **fixed** | glossary lookup matches alias substrings (ranked below term matches) | spec; live: `725000` and `Aufenthaltsgesetz` find *Ausländerrechtliche Verstöße* |
| P11 | **fixed** | notebook log lines carry a level (`INFO:notebook:`, `ctx.log(..., level=)`); SDK exports `Method`, `ReferenceType`, `ContainmentType`, `FieldTransform`, `UsageType`; `same_as`/`references`/`contains` take `evidence` (and `confidence`) | pytest; live: runner log shows `INFO` |
| P12 | **fixed** | `GET /assets/{id}/referencing-findings` and an *About this asset, recorded elsewhere* section under the Findings tab: unresolved findings on assets whose edges point at this one, worst first, naming the asset each came via | live: the Köln-style case — Oldenburg's own Findings tab reads 0 while the section shows 10 findings on 45 assets that point at it |
| P13 | **fixed** | the lineage walk draws a hub but does not expand through it (`hubFanOut`, default 40; `fanOut` on the node says how many edges it really has), and the view fetches real per-asset finding counts from `POST /findings/assets/severity-counts` instead of summing finding nodes a lineage graph never contains | live: from `12411 Fortschreibung`, depth 2 went from **200 nodes, truncated** to **25 nodes, not truncated**, naming two hubs (649 and 93 edges); the UI shows *2 hubs not expanded* |
| P14 | **partly fixed** | `addedBy` reaches the evidence row; `POST /cases/{id}/close` takes `keepInquiries` (also in the MCP tool); the STATEMENT-renames-title behaviour is documented on the endpoint and DTO | spec; live: two answered cases closed with their inquiries still ACTIVE |
| P15 | **fixed** | bulk runs record `triggeredBy` (default `bulk-run`); a bulk sampling change raises `SOURCE_CONFIG_CHANGED` with before/after/actor (`updatedBy`); CLI merges an AUTOMATIC offset into the notebook's stored cursor instead of replacing it, and warns when a window truncates the notebook | spec + pytest; live: notification "set sampling to AUTOMATIC (was ALL) … by verify_platform_fixes", `triggeredBy=bulk-run` |
| P16 | **fixed** | retirement creates the `runner_assets` rows it used to update, so `assetsDeleted` counts | spec; live: `assetsDeleted=1` |
| P17 | **fixed** | *Found 2026-09-20 while diagnosing 25-hour-stale namespaces.* A pg-boss cron fires only while a scheduler is listening at that minute, and nothing replays a window missed while the instance was down — on an instance that is not up around the clock, "daily at 06:15" becomes "never", with every schedule showing enabled and healthy. `SchedulerService.catchUpMissedCronRuns()` starts one run per source whose last window passed unserved (oldest first, 5 per pass, skipping sources already running or queued), at namespace boot and every 10 minutes via the new `cron-catchup` queue. `utils/cron-window.ts` computes the previous occurrence in the schedule's own timezone, DST included, without a new dependency | specs (10 + 7); live: after a restart it found the missed Sunday 01:30 catalogue window in all three namespaces and the 06:15 press window, and started exactly one run each |
| P18 | **fixed** | *The truncated Kubernetes log the third pass could not explain.* Three causes, all fixed: (1) the CLI reports its own completion over REST while the API is still polling the Job, so `finalizeRunner` clears the buffer before the final log read and `appendChunk` dropped what followed — late output is now held (1 MiB, tail kept) and folded in by `flushLateChunks`; (2) a run that outlives an API restart kept running with nobody streaming its output — the reconciler now re-attaches (`followExistingJob`) and stores the Job's whole log; (3) `RUNNER_LOG_DIR` was a per-pod directory while both the api and worker pods drive runs, so the API served only the half it wrote itself (P20) | specs (2 + 4); live: 180 of 180 pod lines stored, last line included (was 45 of 66, and 64 of 2,367 across a restart) |
| P19 | **fixed** | `POST /search/assets` ignored unknown keys and returned the whole corpus with a 200. Its shape (`{assets, findings, page, options, semantic}`) differs from the findings search (`{filters, page}`), so sending the sibling shape silently "matched" every asset in the namespace. Now fails closed like findings, naming the section or filter and suggesting the intended key | spec (4) |
| P20 | **fixed (dev config)** | `helm/develop/values-dev.yaml` set `RUNNER_LOG_DIR` to each pod's own `/tmp` — the production chart deliberately leaves it unset for exactly this reason. Either process drives runs (the API when it promotes a queued runner, the worker when its scheduler starts one), while `POST /runners/{id}/logs` is served by the API alone, so each served a partial log and neither said so. Now a hostPath shared by both pods, created and chowned in `create-cluster.sh` (a kubelet-created hostPath is root-owned; the containers run as 10001) | live: full log served after the change; before it, `EACCES ... mkdir` was the only symptom, in a warning nobody reads |
| P21 | **fixed** | `syncJobLogs` adopted an empty `readJobLogs` result as its delta cursor. An empty read is not an empty log — `findJobPod` finds no pod between Job attempts, and a response with no Content-Type yields `''` — so the next good read looked like a whole new log and re-emitted every line already stored. It **duplicates** rather than drops, which is why the P18 work did not catch it: the missing tail hid the doubling. A read that is a prefix of what is already held now leaves the cursor alone | spec (2), each failing without the fix |
| P22 | **fixed** | The cron catch-up never gave up. `lastRunAt` only advances when a run starts, so a source that *cannot* start stays due forever: one HIVE source in `onedata` whose credentials would not decrypt was retried and warned about 8 times in 70 minutes. Failures now back off (10/20/40/80 min) and stop after five with one line naming the source and the reason; held-back sources are filtered before the per-pass cap, and editing the source clears the state so a fix is picked up at once | spec (4), three failing without the fix |
| new | **added** | `inquiry.new_matches` notification when a run creates findings that match an operator's inquiry (autopilot inquiries excluded). Derived from the run's new findings, not from `newMatchCount`, which stays 0 until someone opens the inquiry | spec (3); live: "New matches: Verify: withdrawn tag" for a never-opened inquiry |

**What held up, so it is not re-litigated:** retirement itself (datasets GovData dropped were DELETED and their
findings resolved; only the counter is wrong, P16); a changed TAG value under the same key resolves and re-opens
cleanly; cross-source URN stitching (`region://`, `genesis://`)
resolved in every direction and order; `relationshipsEmitted/Failed/Lost/Dropped` on the runner were
exact; inquiry `preview` diagnostics named the failing dimension on the first try; `set_cursor()`
survives under `sampling: ALL`; on-demand notebook packages (`openpyxl`, `numpy`) installed without
configuration; `GET /custom-detectors` now returns key and schema; cross-namespace FIFO promoted a
queued run the moment a slot freed.

---

## P1 — One tenant's sweep starves every other namespace for hours

### What happened

The first scan of the first German source was queued behind `firmenbuch-test-2`'s
*Firmenbuch Register*, triggered **35 seconds** earlier by its AUTO scheduler. That source's two
previous runs took **26 minutes** and **13.9 hours**. Nothing in the German namespaces could run —
not a scan, not a connection test (P2) — until the owner authorised switching off the Firmenbuch
schedules and stopping the run.

| | |
|---|---|
| Register run scheduled | 2026-09-17 12:55:22 UTC (`triggerType: SCHEDULED`) |
| German run triggered | 12:55:57 UTC (`MANUAL`) |
| Register's previous durations | 1,565,528 ms · **49,874,477 ms** |
| AUTO state of five Firmenbuch sources | `CATCH_UP`, `intervalSeconds: 900`, runs 54–146 |

### Why

`MAX_CONCURRENT_RUNNERS=1` is now deployment-wide (`countRunningRunners` counts across schemas), and
`dequeueNextPendingRunner` promotes the **oldest** pending runner in any namespace. That is fair per
run, not per tenant: a namespace in `CATCH_UP` re-enqueues every 15 minutes, so it is almost always
holding the oldest ticket, and a single run has no time budget. There is no priority for a manual run,
a first run, or a test.

### Ask

1. Fair queuing **per namespace** (round-robin over namespaces with pending runs) instead of global FIFO.
2. A wall-clock budget for AUTO sweep runs, after which the connector yields (its cursor already makes
   resumption safe) and re-queues at the back.
3. A higher lane for `MANUAL` runs and first runs of a new source, or at least visibility: the UI showed
   the German run as `PENDING` with no position and no reason.

**Re-check 2026-09-19 (v0.5.9):** the new workspace pause (`NamespacePauseService`, 409 on new work) is a
cleaner lever than what was done here (editing another tenant's schedules), but it is still a manual,
all-or-nothing stop by an operator. None of the three asks is addressed.

**Fixed 2026-09-20 — asks 1 and 3.** `findNextPendingRunner` now chooses in two steps. *Lane:* a MANUAL or API
run, and any source that has never completed one, go ahead of scheduled sweeps — both are someone waiting at a
screen. *Round robin:* within the highest lane that has anyone queued, the namespace served longest ago wins,
where never served at all counts as longest; ties inside a namespace stay oldest-first. That is the property
global FIFO lacked: the sweeping tenant re-enqueued every 15 minutes and so always held the oldest ticket, and
under the new rule it goes to the back the moment it is served. The policy is a pure function, `preferQueued`,
tested on the exact timings above (`runner-fair-queue.spec.ts`). `MAX(started_at)` per namespace is asked on
every dequeue, so `runners.started_at` gained an index.

Visibility is `GET /runners/{id}/queue-position`: place in this workspace's queue, whether the run is in the
priority lane, scans running across the deployment, and the instance cap, with a sentence saying which of those
is holding it. A separate call on purpose — `getRunnerStatus` is re-read on every websocket update.

**Ask 2 is not done, and the report's reasoning for it was wrong.** It said a sweep could yield because "its
cursor already makes resumption safe". It does not: `samplingCursor` is written once, at finalize
(`recordRunSamplingCursor`), so a run stopped part-way through loses its position and the next one re-covers the
same ground. A wall-clock budget on top of that would make a long sweep never converge — worse than the
starvation it fixes. It needs the CLI to checkpoint its cursor mid-run first.

---

## P2 — A 3-second connection test needs a full 7 GiB extract slot

### What happened

`POST /sources/{id}/test` on a CUSTOM source returned after **422.5 s**. The test itself ran for
**3 seconds**. The pod spent ~6.5 minutes `Pending`:

```
FailedScheduling  pod/classifyre-test-0f9eef92-…  0/1 nodes are available: 1 Insufficient memory.
```

```
test job:    {"requests":{"cpu":"500m","memory":"7Gi"},"limits":{"cpu":"4","memory":"7Gi"}}
extract job: {"requests":{"cpu":"500m","memory":"7Gi"},"limits":{"cpu":"4","memory":"7Gi"}}
```

### Why

`KubernetesCliJobService.runTestJob` and `runNotebookJob` build from the same `defaultTemplate()` as an
extract, so a connection test or a single notebook cell requests the memory of a docling pipeline. On
a node sized for one extract pod, every test waits for the running scan to finish. The HTTP request is
held open the whole time; behind any ingress with a 60 s timeout it would fail while the job still runs.

### Ask

A separate, small resource profile for `mode: test` and `mode: notebook` jobs, and an asynchronous
test endpoint (start → poll) instead of a request held open for minutes.

**Fixed 2026-09-20 — the endpoint.** `POST /sources/{id}/test/async` returns 202 with `status: RUNNING` and
`GET /sources/{id}/test` carries the answer. Three properties it needs and has:

- It returns before the test does — measured at **70 ms** for a test that took 18 s.
- It survives the replica that started it. The record lives on `sources.connection_test`, not in a `Map`, so a
  poll landing elsewhere or after a restart still finds it.
- It always reaches a terminal state. A thrown test is stored as FAILURE, and one with no result after 15 minutes
  is reported lost rather than left spinning — the failure mode this endpoint exists to remove.

A second start while one is in flight joins it rather than launching another pod, because a second test of the
same source is the same question. The synchronous endpoint stays for connectors that answer in a second.

---

## P3 — On Kubernetes, a connector's test message never reaches the user

### What happened

The notebook's `test_connection()` returned a specific message; the job log has it:

```
{
  "timestamp": "2026-09-17T12:55:41.829851+00:00",
  "source_type": "CUSTOM",
  "status": "SUCCESS",
  "message": "GENESIS reachable: Sie wurden erfolgreich an- und abgemeldet! …"
}
```

The API answered `{"status": "SUCCESS", "message": "Connection test completed."}`.

### Why

`CliRunnerService` (Kubernetes path, `cli-runner.service.ts` ~2310–2355) parses the job output **line by
line** with `JSON.parse`. The CLI prints the result as indented, multi-line JSON, so no single line
parses and the default message wins. On a failure it is worse: `payload.message` becomes the last 20
*non-JSON* lines — log lines and fragments of the JSON document — instead of the connector's own error.

### Ask

Print the result as one compact JSON line, or parse the last complete JSON object in the output. Add a
test with a multi-line result and a failing one.

---

## P4 — A tag the connector stops asserting never resolves

### What happened

The catalogue source first asserted `de_dq_hidden_total_code` on table 46251-0020 (a wrong "total =
ZUGINS"). After a fix, the second run asserted `de_dq_no_total_row` on the same asset **instead** — and the old
finding stayed `OPEN`, last detected in the first run, contradicting the new one:

```
OPEN     de_dq_no_total_row        46251-0020  "Dimension KFZAT2 (19 Codes) hat keine ''-Summe …"   runner 8578887a
OPEN     de_dq_hidden_total_code   46251-0020  "… Summe = ZUGINS (Zugmaschinen) = ACKER + SATTEL"   runner e1fecc2e  ← stale
RESOLVED de_dq_hidden_total_code   31111-0100  (value changed, same key — resolved correctly)
```

When the value changes under the same key the old finding resolves ("Detection no longer present in scan").
When the key disappears from an asset that still exists, it never does.

Reproduced a second time in `de-fruehwarnung` on the monthly permits table 31111-0120: after a tolerance fix
the connector stopped asserting `de_dq_no_total_row` ("BAUGB1 has no total") and asserted the total instead.
Both findings were open on the same asset afterwards — one saying the dimension has a total, one saying it
has none.

### Why

`AssetService.buildResolutionManifest` resolves findings only for (asset, detector) pairs whose detector
reported an OK outcome in that scan — the right caution for a detector that crashed. But
`DetectorPipeline._apply_asset_tags` records an outcome only for the tag keys the asset *currently*
carries. A TAG detector whose key a connector stopped writing reports nothing, so its finding is left alone
forever — unless the whole asset is retired.

For a CUSTOM notebook the asset's tag set **is** the complete assertion: a key that is absent means "no
longer true". Every living connector that re-derives its tags (integrity checks that stop firing on an asset
that stays, alert onsets that move after a data revision) accumulates stale findings this way.

### Ask

Record an OK outcome for every TAG detector hydrated into the run on every asset whose tags were evaluated
(not scan-cache skipped), so an absent key resolves. Add a test: asset yielded twice, key present then
absent.

---

## P5 — `ctx.query_assets()` silently turns off asset retirement for derived sources

### What happened

*GENESIS Länderwirtschaft* reads the 400 district profiles of *GENESIS Kreisprofile* in the same
namespace, aggregates them, and yields its **complete** universe (16 Länder) every run. The run is
declared partial:

```
partial_coverage: True
partial_coverage_reason: "the notebook chose its cohort with ctx.query_assets()"
```

### Why

`Context.query_assets` (`apps/cli/src/notebook/sdk.py`) calls `set_partial_coverage()` on every
successful query. That is right when the query *selects a cohort* and wrong when it *reads an input*.
The notebook cannot undo it: there is no public way to clear partial coverage. The consequence is
silent — an asset this source stops producing is never retired and its findings never resolve.

### Ask

`ctx.query_assets(..., partial_coverage=True)` with an explicit `False` for lookups, or a separate
read API. Log the declaration on the run so it is visible outside the notebook.

---

## P6 — Duplicate review is 100% noise for TAG detectors, and German labels lose their umlauts

### What happened

`GET /correlation/review/portfolio` on `de-statistik-integritaet` after five sources:
**3,556 pairs, 252 assets, 0 of them duplicates.** Every pattern is one TAG detector against itself:

| pattern key | pairs | what the assets are |
|---|---:|---|
| `phonetic:tag_abgeleitete_vs_ver_ffentlichte_geburten` | 1,024 | 65 different Land-years |
| `phonetic:tag_kreis_aufgel_st` | 685 | 76 different dissolved districts |
| `tag_bedeutet_existierte_nicht` | 635 | 112 different districts |
| `tag_regionale_tiefe` | 465 | 31 different tables |

### Why

1. Custom TAG labels are phonetic-eligible by default (`NON_PHONETIC_LABELS` lists only built-in
   identifier labels). The convention the Firmenbuch work established — *the tag value carries the
   reason* — produces templated values ("abgeleitete Geburten 28.083 vs. veröffentlicht 23.126
   (+21.4%) im Jahr 2025 …") that are phonetically near-identical across every finding of a detector.
2. `normalizeLabel` (`correlation/value-normalizer.ts`) is `.replace(/[^a-z0-9]+/g, '_')`: `Kreis aufgelöst`
   becomes `kreis_aufgel_st`, `Kriminalitätsrate zählt Grenzdelikte` becomes
   `kriminalit_tsrate_z_hlt_grenzdelikte`. Distinct labels differing only in umlauts collide, and the
   keys shown in the UI and in `correlation/config` are unreadable.

### Ask

TAG findings correlate on the exact value (or not at all) unless the detector opts in; a Unicode-aware
slug (NFKD + transliteration, `ä → ae`) for label keys.

---

## P7 — `findings/stats` and the Findings page omit INFO

`GET /findings/stats`: `{"total":621,"bySeverity":{"critical":0,"high":9,"medium":252,"low":228}}` —
the severities sum to 489. The missing 132 are INFO (catalogue depth, reforms, EU law, feed events),
21% of this namespace. The tiles on the Findings page show the same four numbers. `findings.service.ts`
fixes the keys to four on purpose ("without inventing a key the UI does not read"). **Ask:** an `info`
key and tile.

**Fixed 2026-09-20.** Both paths carry `info` — the rollup and the six live `count(*)`s — and the Findings page
has a sixth tile beside the other four. The test that matters is not that the key exists but that the severity
keys sum to `total`: that invariant is what the four-key shape broke, and it is what made 607 of
`de-statistik-integritaet`'s 1,176 findings unreachable from the header.

## P8 — A stopped run is recorded as a failure

Stopping the Firmenbuch Register run (`PATCH /runners/{id}/stop`) left `status: ERROR`,
`errorMessage: "Manually stopped"`. `AutoScheduleService.classifyRun` maps `RunnerStatus.ERROR` to
`FAILED`, so an operator stop reads as a failed scan to adaptive scheduling and to every dashboard that
counts errors (the `firmenbuch` namespace already shows a source paused "after 11 consecutive failed
scans"). Not verified end-to-end here, because the schedule had been switched off before the stop.
**Ask:** a `STOPPED` status, excluded from failure streaks.

**Fixed 2026-09-20.** `RunnerStatus.STOPPED` is a real enum value (migration `20260920120000`, replayable with
`ADD VALUE IF NOT EXISTS`, applied to all 12 tenant schemas). `classifyRun` returns `NO_PROGRESS` for it, the
cleanup job treats it as terminal, and the UI gives it its own label and the "set aside" tone rather than the red
one. `MANUAL_STOP_MESSAGE` stays exported because runs stopped before the status existed are ERROR rows carrying
only that text, and the scheduler must keep reading them as decisions.

Worth recording, because it was hidden until the status existed: stopping a run tears its execution down, and the
teardown then reports what it always reports — the process is gone, the Kubernetes Job is not found. `failRunner`
wrote that over the stop and charged the source a consecutive failure. As ERROR-over-ERROR it was invisible; as
ERROR-over-STOPPED it was the first thing the verification caught. The stop is now claimed *before* any teardown
starts, and `failRunner` refuses to record a failure against a run an operator stopped.

## P9 — TAG severity is fixed per detector

The early-warning rule is *HIGH at +30%, MEDIUM at +20%*. With one severity per TAG detector it needs
two detectors (`de_land_alert_insolvencies_3m_yoy_high` and `…_yoy`) with duplicated descriptions, and
every inquiry and case must name both keys. **Ask:** allow `Asset(tags=…)` to carry a severity that
overrides the detector default, bounded by it.

**Fixed 2026-09-20.** `Tag` is importable from `classifyre` and offered by the editor:

```python
Asset(tags={"insolvencies_yoy": Tag("+34%", severity="HIGH")})
```

The detector's severity is a ceiling, not a default — a connector may say "this instance matters less than usual"
and may not promote its own findings past what the operator who created the detector allowed. An over-severe or
unreadable request lands on the ceiling, is warned about, and is recorded on the finding as
`tag_severity_requested`; an applied override is recorded as `tag_severity`. Both are on the finding rather than
only in a log because the log is not reliably kept (see the status section). Two `Tag`s joined under one key
share the most severe band, since they share one finding. `tag_severities` joins the asset's checksum basis only
when a `Tag` sets one, so an existing corpus is not re-checksummed for a feature it does not use.

## P10 — Glossary lookup never searches inside aliases

`GET /glossary/lookup?query=725000` returns nothing, although the term *Ausländerrechtliche Verstöße*
has the alias `PKS 725000`; `query=Aufenthaltsgesetz` likewise misses the alias *Straftaten gegen das
Aufenthaltsgesetz*. `glossary.service.ts` matches aliases only by equality and substrings only against
`term`; the semantic tier needs embeddings, which are off in these namespaces. **Ask:** a partial tier
over aliases.

## P11 — Notebook SDK: the enums an author is told to use are not importable

- `Method`, `ReferenceType`, `ContainmentType` and `FieldTransform` are not exported from `classifyre`.
  `method="HEURISTIC"` as a string works only because the enums are `StrEnum`.
- `references()`, `same_as()` and `contains()` accept no `evidence`; only `flow()` does. A NUTS
  `same_as` matched by hand-checked alias cannot say so.
- `ctx.log()` lines are stored with level `UNKNOWN`, so a runner-log filter on `INFO`/`WARNING` hides
  every line the connector wrote.

## P12 — Findings about an asset are invisible from that asset

The integrity checks are separate assets that `references()` a region. On the Köln region page the
Findings tab reads "No findings found", although *Zensus-Rebasing: Köln* (−74,346, −6.9%) points at it.
An analyst looking at a district cannot see what is known about it without leaving the page. **Ask:** a
"findings on assets that reference this asset" section, or an option to surface them through
`references` edges.

**Fixed 2026-09-20.** `GET /assets/{id}/referencing-findings` walks *incoming* asset-to-asset edges only —
following outgoing ones as well would pull in everything a hub table feeds, which is P13 — and returns
unresolved findings on those assets, worst severity first, each naming the asset it came via. The asset page
renders it under the Findings tab as *About this asset, recorded elsewhere*, and renders nothing when nothing
points here. Live: Oldenburg's own Findings tab still reads 0; the section shows 10 findings on 45 assets that
point at it.

## P13 — Lineage from a region explodes through hub tables

`POST /graph/lineage` (depth 2) from one integrity check returns 200 nodes, `truncated: true`: table
`12411-0015` feeds ~900 assets (every Kreis, every check), so depth 2 is the whole namespace.

The asset page's lineage hotspot panel lists *GENESIS Integritätsprüfungen · 45 assets · 0 findings*
although every asset of that source carries exactly one finding. Confirmed in code: `components/lineage-view.tsx`
renders `GraphExplorer` without `clustering.assetStats`, lineage graphs contain no finding nodes, and
`useClusteredGraph` sums finding counts from exactly those two inputs — so every lineage hotspot shows 0.
**Ask:** collapse hub nodes above a fan-out threshold; pass per-asset finding stats to the lineage view (or hide
the count there).

**Fixed 2026-09-20, both asks.** The traversal draws a hub but does not walk *through* it: above `hubFanOut`
edges (default 40, `0` disables) a node is included and its neighbours are not, and `fanOut` on the node carries
its real degree so the UI can say *2 hubs not expanded* and offer to open it on its own page. The seed is exempt,
or the walk would return the seed alone. Degree is two index probes summed rather than one `OR`, which cannot use
either `(type, id)` index.

For the counts, `POST /findings/assets/severity-counts` answers "how many unresolved findings does each of these
assets carry" for a page of nodes, and `LineageView` passes the result in as `clustering.assetStats` — the input
`useClusteredGraph` was already reading, and which was empty because a lineage graph contains no finding nodes.

Live, from *12411 Fortschreibung des Bevölkerungsstandes* at depth 2: **200 nodes, `truncated: true`** before,
**25 nodes, not truncated** after, with the two hubs named (649 and 93 edges) and four of the 25 assets reporting
the finding each carries.

## P15 — A sampling change from outside cut every scan to 100 assets, silently and without an actor

*Found on the 2026-09-19 re-check.*

### What happened

At **2026-09-18 16:42:42 UTC**, 18 of the 20 GENESIS sources in the three namespaces switched from
`sampling: {strategy: ALL}` to `{strategy: AUTOMATIC}` within the same second, and the three *Tabellenkatalog* sources
were touched again at 16:55:31. Schedules were not changed. The change did not come from the GENESIS tooling:
its API log (`genesis/classifyre/logs/api_calls.log`) has no call on 18 September. The source rows carry only
`updatedAt`, and no notification or audit record names who made the change or what it was.

Four seconds later (16:42:46), MANUAL runs of the three *Tabellenkatalog* sources were started with
`triggeredBy: null`, so the run records have no actor either. They processed **100 of 3,370**, **100 of 266** and
**100 of 455** catalogue entries and completed in about 3 minutes, where a full walk takes 35.

Our own next runs looked just as healthy:

| Source (`de-regionen`) | Yielded by the notebook | Processed | Status | Warnings |
|---|---:|---:|---|---:|
| GENESIS Regionen | 476 Kreis codes + 16 Länder (log: `registry: 476 Kreis codes …`) | **100** (`Phase 1 complete: 100 assets discovered`) | COMPLETED | 0 |
| GENESIS Kreisprofile | 400 | **100** (`assetsUnchanged: 100`) | COMPLETED | 0 |

Nothing was deleted, because AUTOMATIC does not retire assets. That is also why nobody would notice: the other
392 and 300 assets keep their findings as "retained", and they are never re-checked.

The damage outlived the change. The *Tabellenkatalog* run under AUTOMATIC stopped the notebook after 100
assets, so `extract()` never reached `ctx.set_cursor()`, and the CLI stored its positional offset instead. The
notebook's run-to-run state (tables seen empty since when, tables seen returning since when, newest period per
watched table) was replaced by `{"assets": 100}`. The next full run on 19.09 found no history: **116
`de_table_returned` findings were resolved and re-created**, now dated "zurück festgestellt 2026-09-19" instead
of 17.09. No endpoint can restore a source's cursor, so that history is lost for good. The notebook now logs a
warning when its cursor has been replaced.

### Why

- `POST /sources/bulk-update` (`sources.controller.ts` `bulkUpdateSources`) accepts a `sampling` block for any
  source type and any filter snapshot, including CUSTOM sources whose notebook already defines its universe.
- For a notebook that yields everything, CUSTOM AUTOMATIC falls back to a positional window of
  `sampling_window_size()`, which defaults to **100** (`apps/cli/src/sources/base.py:177`,
  `custom/source.py` `_window`).
- From reading the code (not reproduced): when the notebook sets its own cursor, `_record_cursor` returns before
  `record_automatic_offset`, so the positional offset never advances. A cursor-keeping notebook under AUTOMATIC
  would therefore read the *same* first 100 assets on every run.

- `BaseSource._record_cursor_key` (`apps/cli/src/sources/base.py`) builds the next cursor from
  `_next_sampling_cursor or {}`, not from the stored cursor. So a positional write replaces every key a notebook
  kept.

### Ask

1. Record the actor and the diff for every source-config change made through REST or bulk update, as autopilot
   changes already do (`SOURCE_CONFIG_CHANGED`).
2. When a run processes fewer assets than the connector yielded, say so on the runner: a warning such as
   "AUTOMATIC window: 100 of 492 yielded" instead of a clean COMPLETED.
3. For CUSTOM sources, AUTOMATIC should either be refused in bulk updates, or paginate correctly when the notebook
   keeps its own cursor.
4. Merge a positional offset into the stored cursor instead of replacing it. Give operators a way to read and
   restore a source's cursor (it is shown on `GET /sources/{id}`, but it cannot be set).

The GENESIS deploy now compares every source's live config with the manifest (`deploy.py` `live_drift`,
reading `GET /sources/{id}?include=notebook`). It found this drift and restored `ALL` on all 20 sources.

---

## P16 — `assetsDeleted` is always 0: retirement never updates the counter

*Found on the 2026-09-19 re-check.*

### What happened

*GovData Katalog* (`de-statistik-integritaet`, runner `027e0d27-…`) retired four datasets that GovData no longer
lists (three Köln open-data sets, one NVV mobility offer). Their assets are `status = DELETED` with this runner's
id, and their findings resolve. The runner still reports `assetsDeleted: 0`: 6 created + 190 updated + 2,460
unchanged = 2,656, against 2,660 assets now attached to the run. The same happened on *GovData Datenangebot*
(5 retired). No runner in any of the instance's namespaces has ever reported `assets_deleted > 0`.

### Why

`asset.service.ts` (the retirement transaction, ~line 2200) marks the missing assets DELETED and then runs
`tx.runnerAsset.updateMany({ where: { runnerId, assetHash: { in: deletable } }, data: { changeType: DELETED } })`.
A retired asset is by definition one this run did *not* discover, so it has no `runner_assets` row to update. The
update matches nothing. `completeRunner` then counts `runnerAsset` rows with `changeType = DELETED`, which is
always 0.

`GET /sources/{id}/assets` also counts DELETED assets in `total` and has no status filter, and
`POST /search/assets` ignores a status filter. So "how many assets does this source hold right now" cannot be read
from the API.

### Ask

1. Create (upsert) the `runner_assets` rows for retired assets instead of updating them, so the counter, the
   run's asset list and the export show retirements.
2. Exclude DELETED assets from the source asset listing by default, or accept a `status` filter.

---

## P17 — A cron window missed while the instance is down is never served

*Found 2026-09-20, diagnosing "why are the namespaces stale?".*

### What happened

Every GENESIS source showed `scheduleMode: CRON`, `scheduleEnabled: true`, a valid cron and a registered
pg-boss schedule — and the newest run in any of the three namespaces was 25 hours old. The two daily sources
(06:15 and 06:45 Europe/Berlin) had not run that morning.

The schedules were fine. `pgboss.schedule` held every row, the dispatcher was busy (97 `__pgboss__send-it` jobs
that day), and a probe schedule set two minutes ahead fired to the second and started its scan. What the
namespaces had missed was the *window*: the API and worker pods were down at 04:15 UTC and came up at 07:49.

```
job_common: no ingest-source-* job had ever been created
worker pod:  started 2026-09-20T07:48:59Z
due:         04:15 UTC (press), 04:45 UTC (change feed), 23:30 UTC Sat (weekly catalogue)
```

### Why

pg-boss sends a cron job only while a scheduler is listening at the minute the clock matches. Nothing replays
a window that passed while it was not. `scheduleNextAt` is null for CRON by design (it belongs to the adaptive
scheduler), so nothing in the model records that a window was owed, and no boot path looks backwards.

On a machine that sleeps — a laptop k3d cluster, a VM with a maintenance window, any instance that is not up
around the clock — "daily at 06:15" silently becomes "never", while the UI reports the schedule as enabled.

### Fix

`SchedulerService.catchUpMissedCronRuns()`: for each enabled CRON source, compute the previous occurrence of its
cron in its own timezone and start one run when the source's last run predates it. Oldest miss first, at most 5
per pass, skipping anything already RUNNING or PENDING; it runs at namespace boot and every 10 minutes on the new
`cron-catchup` queue. `utils/cron-window.ts` computes the occurrence with a bounded backwards walk (exact across
DST, no new dependency — `cron-parser` is in the bun store but not a direct API dependency).

Live: on the next reload it logged *"Catch-up run for GENESIS Tabellenkatalog: its 2026-09-19T23:30:00.000Z window
passed while nothing was scheduling"* in all three namespaces, plus the 06:15 press window, and started exactly
one run each — queued behind the single scan slot.

---

## P18 — On Kubernetes the stored run log stops before the end

*The bug the third pass recorded as found-but-unfixed; root-caused and fixed here.*

### What happened

The stored log of a Kubernetes run is a prefix of what the job printed. Reproduced by diffing a pod's log against
the stored entries for the same runner:

```
pod printed:  66 lines
stored:       45 lines   (last: "INFO:notebook: GENESIS: 1 calls, 1s, …")
missing:      21 lines, beginning exactly at "Phase 1 complete: 12 assets discovered"
```

Everything the detector pipeline and its worker pool print — including every connector warning — can be lost.

### Why

The CLI reports its own completion over REST (`updateRunnerStatus`) while the API is still polling the Job for
output. `completeRunner` → `finalizeRunner` then clears the in-memory buffer, and the API's *final* log read
arrives afterwards. `appendChunk` finds no buffer for that runner, takes the "not initialised on this replica"
branch, and returns DTOs it never persists. The lines are dropped in silence — the same shape as P15's window,
one layer down.

### Fix

Late output is held per runner (`lateChunks`, 1 MiB cap keeping the tail) instead of being dropped, and
`flushLateChunks(sourceId, runnerId)` folds it into the stored NDJSON. The Kubernetes path calls it as soon as
the job wait returns, before the terminal transition. A replica that never flushes simply drops the memory.

---

## P20 — Run logs were split across two pods, and each served half

`helm/develop/values-dev.yaml` sets `RUNNER_LOG_DIR: /tmp/classifyre/runner-logs`. The production chart
deliberately does **not** set it, and says why: the filesystem backend writes to one pod's own directory.

On this deployment both processes drive runs — the API when it promotes a queued runner, the worker when its
scheduler starts one or re-attaches after a restart — while `POST /runners/{id}/logs` is served by the API. So
each wrote part of each run's log to its own disk, and the API served only its part, with no indication that the
rest existed:

```
runner 62a4881e (de-regionen catalogue walk)
  Job printed        2,367 lines
  API served            64   (written before the API restarted mid-run)
  worker's own file  complete (written by the re-attachment, on the other pod)
```

Fixed for dev by mounting one hostPath into both pods (the worker deployment already reuses
`api.extraVolumeMounts`), created and chowned to 10001 in `scripts/dev/create-cluster.sh` — a hostPath the
kubelet creates is owned by root, and the first attempt failed with `EACCES: permission denied, mkdir` in a
warning that reached no one but the pod log. A multi-replica production instance needs object storage
(`objectStorage.enabled`), which is what the chart's comment already recommends.

---

## P19 — `POST /search/assets` ignored unknown keys and returned everything

Its request shape is `{assets, findings, page, options, semantic}`; the sibling findings search takes
`{filters, page}`. Sending the findings shape returned **every asset in the namespace** with a 200, and a caller
that believes it filtered draws conclusions from the wrong set — the same failure mode as the 2026-09-14 findings
incident, which is why findings already fail closed. Assets now do too: unknown sections and unknown asset
filters are rejected with the known list and a suggestion (`sourceIds` → `sourceId`).

---

## P14 — Smaller

- Asset metadata renders integer years with thousands separators (`Last Year 2,025`).
- `POST /cases/{id}/findings` ignores `addedBy`; the resulting evidence has `addedBy: null`.
- The case graph counts disagree with the case header: "11 EVIDENCE · 11 FINDINGS" above a graph whose stats
  read "Findings 0 · Evidence records 11". The same graph shows a `LIKELY_DUPLICATE` edge between two unrelated
  census checks — P6's noise reaches cases.
- `runner.totalFindings` counts findings *reported* by a run, not created: a re-run that changed one asset
  reported 398 against 397 on the first run, with one finding resolved and one opened.
- `POST /runners/{id}/logs` returns `entries` where every other list endpoint used here returns `items`;
  `POST /search/assets` defaults to assets *with findings* (`includeAssetsWithoutFindings: false`), so a
  source's asset count read from it is wrong by default (400 PKS assets reported as 8).
- The worker pod was `OOMKilled` (exit 137, 3 GiB limit) twice during the session (12:21 and 13:33 UTC)
  while ingest and correlation ran; cause not established.
- Migration `20260917120000_clear_stored_scan_error_text` nulls `error_message`/`error_details` on **every**
  runner, including messages already stored through the new redaction path. On this instance 17 of 18 `ERROR`
  runners lost their cause. One was ours: a *GENESIS Länderwirtschaft* failure at 15:52 whose redacted
  message (`GenesisError: [tablefile 31111-0100] GENESIS status 7000 …`) the tooling had read from
  `GET /runners/{id}` was gone by 19 September. A one-off scrub is defensible. It could have been limited to
  rows written before the redaction shipped (`completed_at < <release>`), or to rows that match the credential
  shapes.
- Case evidence does not follow a finding's successor. When a TAG value is reworded (Spree-Neiße's holder text,
  a recount of the hidden-total groups), the old finding resolves and a new one opens, and the case keeps citing
  the resolved one. The GENESIS deploy re-attaches the current finding. The platform could offer this, since both
  share asset, detector and key.
- Adding a `STATEMENT` entry to a hypothesis replaces the thread's **title** with the first 200 characters of the
  entry body (`case-threads.service.ts:261`). Nothing in the endpoint or its OpenAPI description says so. A dated
  revision ("Review 19.09.2026: 12 of the 30 …") became the title of five hypotheses. The GENESIS deploy addresses
  hypotheses by title, so it then created duplicates, which were deleted by hand. Revisions are now NOTE entries.
  Either document the behaviour, or keep the title unless it is changed explicitly.
- Closing a case archives its linked inquiries (`CloseCaseDto`). An *answered* case whose inquiries are standing
  checks ("Zahlen, die nicht aufgehen": the non-additivity and census-identity checks catch next year's
  mismatches) therefore cannot be closed without switching the checks off. Closing should offer to keep them.
- Observation, not a defect: a scan registers stubs during `extract()` and runs detectors only after it
  returns (`main.py`, Phase 1/Phase 2), holding every asset in memory in between. A 25-minute catalogue
  walk showed 3,370 assets and 0 findings for 25 minutes.

---

## P21 — The log reader re-sent the whole log after an empty read

`syncJobLogs` tracks what it has already streamed and appends only the delta:

```ts
latestOutput = await this.readJobLogs(namespace, jobName);
// ...
const nextChunk = latestOutput.startsWith(previousOutput)
  ? latestOutput.slice(previousOutput.length)
  : latestOutput;
```

`readJobLogs` returns `''` in two ordinary situations — `findJobPod` finds no pod while the Job is between
attempts, and a pod-log response that arrives with no `Content-Type` is deliberately turned into `''`. Neither
means the log is empty. The pass itself emitted nothing (`''.startsWith(previousOutput)` is false, so the chunk
was `''`), but `''` became the new cursor, and on the next successful read `latestOutput.startsWith('')` is
true — so the entire log so far was handed to `appendChunk` a second time.

The effect is the opposite of P18: lines are **duplicated**, not lost. That is exactly why the P18
investigation did not find it. A stored log that was missing its tail and doubling its head reads as one
corruption, and the missing tail is the half that gets noticed.

The guard is the symmetric one: a read that is a *prefix* of what is already held — empty, or merely short —
is an unavailable read and leaves the cursor alone. A read that **diverges** still replaces it, because that is
a retried pod whose output is genuinely new.

---

## P22 — A source that could never start was retried forever

The catch-up sweep (P17) starts a run for every CRON source whose last window passed unserved. It decides by
comparing `previousCronOccurrence` with `lastRunAt` — and `lastRunAt` only advances when a run actually
*starts*. A source that cannot start therefore stays due for every pass, for as long as the instance lives.

For a transient reason that is the intended behaviour, and the code said so: a paused namespace, a source
already claimed, the single scan slot held elsewhere. For a permanent one it is a loop. A HIVE source in
`onedata` whose credentials would not decrypt produced:

```
8 × "Catch-up run for source <id> not started: Failed to decrypt source credentials"
   in 70 minutes, identical every time
```

No backoff, no end, and — because every line was identical and at WARN — nothing to distinguish "this just
happened" from "this has been happening all morning".

Now each consecutive failure doubles the wait before the next attempt (10, 20, 40, 80 minutes), the first
failure warns and the ones between are DEBUG, and the fifth stops the retries with a single line that says so:

```
Catch-up for "<name>" (<id>) gave up after 5 failed starts: <reason>.
It will not be retried until the source is changed or this instance restarts.
```

Held-back sources are filtered out *before* the five-runs-per-pass cap, so a broken source cannot crowd out
healthy ones. The record is keyed on the source's `updatedAt`, so correcting the credentials clears it and the
next pass tries immediately rather than waiting out a backoff.

**Two versions of this fix did not work, and only the live check said so — each time.**

*First*,  `clearForSchema` runs every
time a namespace's workers are torn down — a routine event, not a shutdown — and it cleared the failure
records along with the queue registrations. Every pass therefore started from an empty map, and the dev
cluster showed the same source at `attempt 1/5` at 08:43, 08:47, 08:50, 08:53 and 09:02: a counter that never
advanced and a warning that never stopped, which is precisely the behaviour the fix was meant to end. The
records describe the source, not the worker registration, so they now outlive the teardown (`1f2a5a5f`). The
unit tests passed throughout because none of them tore a namespace down; one that does has been added.

*Second*, the counter still would not advance — 09:02, 09:07, 09:09, 09:13, 09:20, all `attempt 1/5`, with no
restart between them. The record is keyed on `Source.updatedAt` so that editing a source retries it at once
instead of serving out a wait it no longer deserves. But `updatedAt` is not "someone edited the config"; it is
*any write to the row*, and **the failing path writes to the row itself**: `startRun` claims the source with a
`currentRunnerId`, fails to decrypt, and restores the previous value — two writes per failed attempt. The
value captured before the attempt therefore never matched the row after it, the sweep concluded the source had
been edited, and it cleared its own backoff every single time. The value is now re-read *after* the attempt
(`e5ac06f8`), so a later pass compares against what the failure left behind and only a genuine edit differs.

Both bugs shared a shape worth naming: **the test doubles were too clean.** A `startRun` that is a bare
rejection writes nothing, and a service that is never torn down keeps its state. Each fix looked right, passed
its tests, and did nothing in production. The regression tests now model the write and the teardown.

**Not durable, and that has a sharper edge in dev than in production.** The state is per-process: a restart
retries every given-up source once. That is deliberate — a restart is exactly the event after which a source
deserves a fresh try — but it assumes the process is long-lived. Under `bun --watch` the dev worker restarted
six times in three hours (every edit to an API file reloads it), and a backoff cannot accumulate across
restarts that frequent. On a stable deployment it holds; on a laptop cluster being actively edited, the
warning loop comes back. Making "cannot start" survive a restart — and making it visible in the API or UI
rather than only in a pod log — needs a source-level status column, which is a schema change and is not in
this fix.

---

*Evidence files:* `genesis/classifyre/logs/` (runner records, batch results, API call log) and
`genesis/classifyre/state/` (ids per namespace; the Firmenbuch schedule snapshot taken before P1's stop).
