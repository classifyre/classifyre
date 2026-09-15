# Platform requests from a large multi-source namespace

**Status:** proposal · **Raised:** 2026-09-14 · **Evidence:** `firmenbuch-test-2`
(`ns_ce706ed0b05944878b71fd90ea8e22ba`)

Every number in this document is a query result against a live namespace, not
an estimate. Where a request exists because something was *tried and failed*,
the attempt is described — that is usually the strongest part of the argument.

## Why this namespace is a useful stress test

Six CUSTOM notebook connectors describing the same Austrian companies from
different angles, against a published universe of **326,479 Firmenbuchnummern**.

| | |
|---|---|
| Assets | 187,710 |
| Findings | 686,943 open |
| of which HIGH/CRITICAL | 9,093 (**1.3%**) |
| Companies scanned | 39,510 |
| Companies with an actionable finding | 2,202 (**5.6%**) |
| Register coverage, best source | 11.7% |
| Register coverage, source carrying the financial analysis | **1.43%** |

It is the shape a real customer deployment has: a corpus far larger than any
single scan, a low signal ratio, several sources of very different cost, and a
question ("who am I dealing with") that is answered by a small fraction of what
gets ingested.

---

## Requests, ranked

| # | Request | Why it cannot be solved in the namespace | Impact |
|---|---|---|---|
| 1 | `ctx.query_assets()` — let a connector read its own namespace | Connectors are write-only into the graph | **Highest** |
| 2 | Retire findings a narrowed detector can no longer produce | No API expresses "this detector no longer applies here" | High |
| 3 | Yield-aware scheduling | Scheduler owns the feedback loop | High |
| 4 | Per-asset "record without extraction" | Asset has no such field | Medium |
| 5 | Wall-clock budget per detector per run | Runner owns the detector pool | Medium |
| 6 | Stop one slow asset stalling discovery | Pipeline back-pressure is platform-side | Medium |
| 7 | Bulk finding operations that scale | Server-side | Medium |

---

## 1. `ctx.query_assets()` — a connector cannot read what the namespace knows

### The problem

A connector can write assets, findings and edges. It cannot ask what is already
there. So every source derives its work list from the **external** universe,
because that is the only thing it can see.

The consequence here: five sources independently sweep the same 326,479
Firmenbuchnummern, at five different costs, discovering the same facts.

### What was tried, and why it failed

Two legal forms produce no risk signal at all:

| Legal form | Companies scanned | With a HIGH/CRITICAL finding |
|---|---:|---:|
| AG | 379 | 7.9% |
| GES (GmbH) | 26,332 | 5.7% |
| KG | 4,716 | 5.2% |
| GEN | 873 | 0.1% |
| **EU** (Einzelunternehmer) | 4,649 | **0.0%** (2 of 4,649) |
| **OG** (Offene Gesellschaft) | 1,269 | **0.0%** (0 of 1,269) |

They are not under-detected — they are out of scope by construction: no share
capital and no § 277 UGB publication duty, so the distress, capital-structure
and filing-gap detectors have nothing to read. With GEN they are **17% of the
corpus and produced three findings between them**.

A guard to skip them was written into the two expensive connectors and then
**reverted before it ran**, because it is dead code by construction: those
connectors only learn a company's legal form from a filing, and the companies
worth skipping are exactly the ones that never file. The guard could never
fire.

The Register connector knows every company's legal form. The Financials
connector cannot use it, because reading another source's assets is not
possible — and *should not* be done by reaching into another source's private
state, since the five are deliberately built to fail independently.

### Proposed shape

```python
cohort = ctx.query_assets(
    kind="record",
    where={"metadata.filing_count": {"gt": 0},
           "metadata.legal_form_code": {"in": ["GES", "AG", "SE", "FKG"]}},
    not_visited_by_this_source_since="90d",
    limit=1200,
)
```

Read-only, scoped to the calling namespace, with the same field-level access
the MCP asset search already exposes. It does not let one connector reach into
another's internals; it lets a connector read the **shared graph** they all
write to, which is the thing that is already public between them.

### Why it matters beyond this namespace

This is the difference between *"sweep the universe"* and *"work the queue of
things we already know are interesting"*. Any namespace with a cheap
discovery source and an expensive enrichment source has this shape — CRM plus
document store, ticket system plus attachments, registry plus filings. Today
every one of them must re-derive selection externally.

**Measured upside here:** 25% of the companies the Financials source visits have
zero filings, and the Register source already knows that. Removing those, plus
the 17% of non-filing legal forms, is roughly a third of its cohort spent on
companies that cannot produce a result.

---

## 2. Retiring findings a narrowed detector can no longer produce

### The problem

`DetectorScope` and pattern edits stop a detector producing **new** findings.
They do nothing about the findings it already produced, and there is no
supported way to retire those.

### Evidence

Two changes were made on 2026-09-14, both correct, both verified working:

- `at_company_ids` scoped to `asset_kinds: ["record","document"]`, removing it
  from EVI publication pages (56,763 findings, **99.98%** of which were the
  page restating its own Firmenbuchnummer) and Bilanzanalyse tables (5,629,
  99.9%).
- the `EUID` pattern removed entirely — `ATBRA.008316-000` is FN `008316f`
  rewritten, all 37,428 matches were a record's own identity, and no source
  here uses EUID as a key.

A verification run confirmed the scope works: 1,600 assets scanned,
`findings_by_detector` carried **zero** `at_company_ids` entries. And the old
findings stayed `OPEN` — all 99,820 of them.

This is correct *default* behaviour and should stay: a detector that did not run
must not resolve its findings, or a crashing detector would silently destroy
evidence (finding survival deliberately rests on an empty `detectorOutcomes`
manifest). But "did not run because it crashed" and "did not run because it no
longer applies here" are different facts, and only the platform can tell them
apart.

### Proposed shape

Either an explicit action —

```
POST /custom-detectors/{id}/retire-out-of-scope-findings
```

— resolving findings the detector's *current* configuration could not produce,
with a reason recorded in history; or a `retire_narrowed_findings` flag on the
detector update, alongside the existing `cleanup_removed_detector_findings`
option for fully removed detectors. The asymmetry today is that removing a
detector has a cleanup path and narrowing one does not.

### Impact

15% of this corpus is findings that no configuration will ever refresh again.
They still cost storage, embeddings, evidence analyses and correlation work,
and they still appear in inquiry match counts — one standing question here
reports **182,155 matches** largely composed of them.

---

## 3. Yield-aware scheduling

### The problem

AUTO decides *when* a source runs and *how wide*. Nothing decides *what* it
scans, so the cohort walks its universe in whatever order the connector's
author chose.

### Evidence

The sweep walked Firmenbuchnummern ascending, which is registration order:

| Registered | Scanned | Actionable | Rate |
|---|---:|---:|---:|
| 1990s | 29,325 | 829 | **2.8%** |
| 2000s | 1,841 | 58 | 3.2% |
| 2010s | 3,330 | 200 | 6.0% |
| 2020s | 5,014 | 1,115 | **22.2%** |

**8× difference across the walk**, with 74% of the budget going to the least
productive end. Fixed in the connector by reversing the walk and adding
priority bands (`newest:60,oldest:30,random:10`).

### Why the platform should own it

The connector fix is a hand-tuned constant. The scheduler already tracks
whether a scan ingested anything new, in order to widen or back off. Extending
that signal from *"did this scan find anything"* to *"which band did it find it
in"* turns a hard-coded split into a measured one, and generalises to any
connector that enumerates a large ordered universe.

Note this is **not** `sampling.strategy`. Sampling acts on the stream the
connector already produced; by then the expensive API call has happened. It can
discard work, never avoid it. Selection has to happen where the cohort is
chosen.

### Related: a cohort primitive in the SDK

The shared cohort cell in this namespace is ~300 lines of resumable-cursor
logic — universe fetch, bisect resume that survives republication at a
different length, band splitting, dedup, wrap. Every connector enumerating a
large external universe needs exactly this and will rewrite it. It belongs in
the SDK.

---

## 4. Per-asset "record it, do not extract it"

### The problem

An asset either carries `content_bytes`, in which case the platform extracts
it, or it does not, in which case the record is impoverished. There is no way
to say "this artefact exists, here is everything known about it, do not spend
minutes parsing it".

### Evidence

Filed PDFs go through docling's `StandardPdfPipeline`. Measured: a 27-page
`Konzernabschluss` took **17.4 minutes** on its own; a 45-page filing held a run
for 7 minutes; runs were OOMKilled at 215–266 minutes before the cost was
bounded.

The workaround was to null `content_bytes` and record `bytes_skipped` in
metadata — which works, but expresses the intent by removing data rather than
by stating it, and leaves the asset looking like a fetch failure to anything
that does not know the convention.

### Proposed shape

`Asset(..., extract=False)` — or `content_disposition="reference"`. The asset
is complete, indexed by metadata, participates in lineage, and is skipped by
the extraction pipeline.

---

## 5. A wall-clock budget per detector per run

### Evidence

`fb_solvency_outlook` runs against a free-tier LLM endpoint that refuses the
key. `CLASSIFYRE_LLM_MAX_ATTEMPTS` defaults to 4 with exponential backoff —
15–20 seconds per asset:

```
09-13 07:30   157 min   failed on 451 of 451 assets
09-13 02:03   121 min   failed on 352 of 358
09-12 22:20   142 min   failed on 383 of 431
```

Over two hours per run to arrive at the answer the first attempt already had.
Setting the variable to 1 took the same source from ~150 minutes to **6.5**.

An env var is a blunt instrument: it is instance-wide, so it cannot say
"retry the paid provider, do not retry the free one". A per-detector budget —
max attempts, or a wall-clock ceiling after which the detector is marked
degraded for the run — puts the limit where the cost is.

### Compounding factor

`MAX_CONCURRENT_RUNNERS` is 1 on this node (one extract pod fits the memory
budget). So those two hours are two hours in which every other source waits. A
failing detector on one source starves the whole namespace.

---

## 6. One slow asset should not stall discovery

### Evidence

Repeatedly observed, and the thing that prompted "why are all assets PENDING":

```
18:33  100 assets discovered / 0 processed
18:39  100 assets discovered / 0 processed     <- six minutes, no movement
```

The pipeline queue is bounded (~100), the connector back-pressures when it
fills, and the detector pool was **one worker** — `compute_pool_workers()` sizes
as `cpus - 1` from the cgroup quota, so a 2-CPU limit is always a single worker.
One expensive document therefore stops discovery, processing, and every asset
behind it.

Raising the CLI job to 4 CPUs (`effective=3`) helped but did not remove it:
discovery still froze the moment a docling conversion started.

Worth considering: a separate lane for assets whose extraction is expensive, so
the cheap majority continues to flow; or decoupling discovery from detection
with a larger buffer.

---

## 7. Bulk finding operations that scale

Resolving 37,428 findings through `POST /findings/bulk-update` did not complete
within **15 minutes** and timed out at the MCP layer first. Post-#278 the
filter path correctly writes history per finding, which is the right fix for
the re-open bug — but it turns a bulk operation into a row-at-a-time walk.
Sampled mid-flight, the work is real and sequential: all 37,428 findings had
their history entry written, and the connection was then inserting
`custom_detector_feedback` one row at a time.

So the cost is two per-finding writes plus the status update, issued serially
inside one request. Correct, and the wrong shape for a operation an operator
reaches for precisely when iterating on detector configuration.

Any namespace doing detector iteration at this scale needs bulk status changes
to be a background job with progress, not a synchronous request.

---

## Platform bugs found while doing this

Reported for awareness; the second has a fix and a regression test.

### 0. A mistyped filter key silently widens a destructive bulk operation to the whole corpus

**This is the most serious thing in this document.**

`POST /findings/bulk-update` with

```json
{"filters": {"findingTypes": ["regex:EUID"], "status": "OPEN"}, "status": "RESOLVED"}
```

was intended to retire 37,428 findings. The recognised filter key is
`findingType` — **singular**. `findingTypes` is not a key
`buildBaseFindingsWhere` reads, so it was dropped, the `where` collapsed to
`status: OPEN`, and the operation began resolving **all 686,943 findings in the
namespace**.

Three things combined:

- `filters` is typed as `SearchFindingsRequestDto['filters']`, but there is no
  global `ValidationPipe`, so at runtime it is whatever JSON arrived. The
  comment in `buildBaseFindingsWhere` even notes that the MCP server "passes
  raw JSON without class-transformer coercions".
- The MCP tool schema declares `filters` as an open object
  (`additionalProperties: {}`), so it constrains nothing and a typo reaches the
  service intact.
- An empty `where` on a **destructive** operation means *match everything*,
  which is the most dangerous available default.

It was caught only because the request exceeded its own client timeout twice
and the residue looked wrong: 1,366,943 `custom_detector_feedback` rows against
a table that had been empty, spanning `distinct_findings = 686,943` — the whole
corpus, not the 37,428 asked for.

No status was changed: both attempts timed out before the `updateMany`
committed, and the still-running backend was terminated. But history entries
and feedback rows are written **before** the update (a deliberate trade recorded
in #278), so the partial failure left every finding in the namespace carrying a
`RESOLVED` history entry for a resolution that never happened — and
`findingHasManualStatusOverride` reads exactly that history to decide whether a
resolution was deliberate. Both side effects were cleaned up by hand.

**Asks, in order of value:**

1. **Reject unknown keys in `filters`** — for a destructive operation, fail
   closed. An unrecognised filter should be a 400, never a wider match.
2. **Refuse an unbounded destructive bulk update.** If `filters` resolves to an
   empty `where`, require an explicit `confirm: true` the way
   `purge_source_findings` already does.
3. **Constrain the MCP `filters` schema** to the keys the service actually
   reads, so a typo fails at the tool boundary.
4. Consider making history/feedback writes conditional on the update
   succeeding, or making the whole thing a background job with progress (see
   request 7) — the current ordering means a timeout is not a no-op.

1. **A stopped run deadlocks the queue against itself.** `stopRunner()`
   transitions to a terminal state but never calls `dequeueNextPendingRunner()`,
   unlike `completeRunner()` and `failRunner()`. Since `AutoScheduleService`
   counts `PENDING` toward the concurrency cap, a queued runner then holds the
   only slot *against itself* until the next restart — surfacing later as
   `"Runner was left pending during application restart"`. Observed: a run idle
   for 25+ minutes on an empty cluster with `Auto-schedule yielding: 1 scan(s)
   already in flight (cap 1)` on repeat. Fixed in
   `apps/api/src/cli-runner/cli-runner.service.ts` with a test verified by
   reverting the fix. Uncommitted.

2. **Worker OOMKilled at 3Gi against a documented expectation of "low hundreds
   of MB".** `values-dev.yaml` justifies the 3Gi cap on the basis that the
   inference batch is now bounded. Sampled live while draining an 11,550-job
   embedding backlog: **~2.1 Gi sustained, 70% of cap**, CPU pegged, six
   restarts. `EMBEDDING_BATCH_SIZE` (32) and `EMBEDDING_QUEUE_BATCH_SIZE` (64)
   are both at defaults. Not changed — it is deliberate, freshly reasoned
   tuning that affects every namespace.

---

## Appendix — what was solved without platform changes

So the requests above are not a wish list standing in for work that could have
been done locally:

| Problem | Namespace fix | Result |
|---|---|---|
| Sweep walking away from the answer | reversed walk + priority bands | 8× yield ordering |
| Runs OOMKilling on filed PDFs | skip PDF where an XML sibling exists | 215–266 min → 8.9 min |
| PDF-only filings dominating runs | measured size cap, bytes recorded not ingested | bounded |
| AI detector starving the namespace | `CLASSIFYRE_LLM_MAX_ATTEMPTS=1` | 150 min → 6.5 min |
| 94% of the HIGH band benign | split `fb_status` / `fb_status_adverse` | HIGH 93,884 → 3,273 |
| Two sources unable to agree | normalised status vocabulary | cross-source comparison possible |
| Identifier noise | detector scoped to record/document | −99,820 findings (forward) |

The seven requests are what remains after that.
