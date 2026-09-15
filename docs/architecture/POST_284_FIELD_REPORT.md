# Field report: #284 verified against `firmenbuch-test-2`

**Status:** action required · **Verified:** 2026-09-15 · **Namespace:**
`firmenbuch-test-2` (`ns_ce706ed0b05944878b71fd90ea8e22ba`) ·
**Against:** [#284](https://github.com/classifyre/classifyre/pull/284)

#284 implements all seven requests and bug 0 from
[`CONNECTOR_PLATFORM_REQUESTS.md`](CONNECTOR_PLATFORM_REQUESTS.md). This is the
verification on the corpus those requests came from — the one the PR
deliberately only dry-ran against.

**Five of eight are confirmed working. One is unusable at this scale, and that
one is the feature this namespace most needs.**

Corpus at time of check: 264,476 assets · 925,259 open findings · 23,735
HIGH/CRITICAL · 55,141 companies · 0 DELETED · `findings` heap 2,743 MB across
18 indexes.

---

## Confirmed working

| Item | Evidence |
|---|---|
| **bug 0** | The §16.6 incident payload now returns `400 Unknown finding filter key(s): findingTypes (did you mean "findingType"?)`. `findingType` + `dryRun` returns `{"wouldUpdate":37428,"narrowed":true}` — exactly the hand count. A status-only filter is refused without `confirm`. |
| **#5 detector breaker** | Bilanzanalyse: **121–188 min → 10.9–18.3 min**. Every run carries `detectorsDegraded: [{cause: "provider_refused"}]` and still produces 148–881 assets. |
| **#6 discovery** | 1,100 → 1,403 assets in under two minutes, steady. The freezes at exactly 100 assets are gone. |
| **#7 background ops** | The dry run survived a worker restart mid-flight (`Resumed 1 interrupted bulk operation(s)`), continued from 40,298, completed. |
| **#2 dry run** | 56,764 `asset_kind:page` + 5,629 `asset_kind:table` + 37,428 `pattern_removed:EUID` = **99,821**, matching independent SQL. Correctly held back 62,392 findings watched by an active inquiry. |

`ctx.query_assets()`, `ctx.cohort()` and `Asset(extract=False)` are present in
the SDK and **unused by this namespace** (0 query calls across 44 runs, 0 runs
carrying `cohort_yield`). That is migration work on our side, not a defect.

---

## P1 — `retire-out-of-scope-findings` cannot execute on a real corpus

### What is not working

`dryRun: false` fails deterministically. Two attempts, identical, `processed: 0,
changed: 0` — it never retires a single finding.

```
Invalid `tx.inquiry.findMany()` invocation in
  apps/api/src/findings-bulk/retire-out-of-scope.service.ts:525:38
Transaction API error: A query cannot be executed on an expired transaction.
The timeout for this transaction was 30000 ms, however 34014 ms passed since
the start of the transaction.
```

The stack points at line 525, but that is where the transaction happens to
notice. **The cost is the page UPDATE itself.**

### Root cause, measured

`retireChunk` wraps one page in `this.prisma.$transaction(..., { timeout:
30_000 })` (line 457). One page is `BULK_OPERATION_PAGE_SIZE = 2000` findings,
and `retirePage` sets `status`, `resolved_at`, `updated_at` and appends to the
`history` JSONB.

Timed directly against this corpus, the UPDATE alone, nothing else in the
transaction:

| rows | time |
|---:|---:|
| 250 | 7.3 s |
| 500 | 5.7 s |
| 1,000 | 12.5 s |
| **2,000 — the configured page** | **33.4 s / 43.4 s / 11.1 s** |

**The variance is the real finding, and it is more important than any single
number.** Three runs of the same 2,000-row UPDATE took 11.1 s, 33.4 s and
43.4 s depending on how much of the heap was already in cache. Two of the three
exceed the 30 s budget; one does not. That is why this fails intermittently
rather than cleanly, and why raising the timeout to a number derived from one
measurement would not fix it — 45 s would still have lost the 43.4 s run on a
colder cache or a busier disk.

`findings` here is a 2,743 MB heap with **18 indexes**, four of which include
`status`, so these updates cannot be HOT and every row maintains index entries.
`shared_buffers` is 768 MB against that 2,743 MB heap, so the working set does
not fit and the cost is dominated by I/O that varies run to run.

The constant's own comment says a page "must stay small enough never to hold
locks or block vacuum for long" — the sizing was measured for the *scan*
(`RETIRE_SCAN_BLOCKS`: "10,000 blocks in 4.9 s"), not for the write, and not
against a heap that does not fit in cache.

This is why the dry run passes and the retire does not: the dry run performs no
UPDATE and therefore opens no transaction.

### Why it was not caught

The PR's test plan states destructive paths were exercised "in a throwaway
namespace" and that "the namespace that raised the requests only saw dry runs".
A throwaway namespace has a small `findings` heap and few indexes, so the page
UPDATE is fast and the 30 s budget is never approached.

### What should be done

In rough order of preference:

1. **Do not put a whole page in one fixed-budget transaction.** Commit per
   reason group, or per sub-batch sized to a target duration. Correctness does
   not need page-level atomicity: each row's status and history move together,
   and the operation is already resumable from its cursor.
2. **Size the write batch by measured throughput, not by a constant.** Time the
   first batch and adapt, the way `BULK_OPERATION_CHUNK_BUDGET_MS` already
   adapts the handler's wall clock. A fixed 2,000 cannot be right across a
   1 MB and a 3 GB `findings` table.
3. **Do not fix this by raising the timeout to fit the slowest observed run.**
   The spread here is 4× on identical work; any constant chosen from a
   measurement is a constant that fails on a colder cache. If a fixed page is
   kept, the timeout must come from it *and* carry enough margin for that
   spread — which in practice means a much smaller page.
4. **Hoist `tx.inquiry.findMany()` out of the per-group loop.** It reloads and
   recompiles every ACTIVE inquiry matcher once per reason group inside the
   transaction. It is not the root cause, but it is avoidable work in the most
   expensive place, and the re-check only needs to be as fresh as the
   transaction.
5. **Fail with the real reason.** "Transaction expired at `tx.inquiry.findMany`"
   sent us to the wrong line. A page that exceeds its budget should say so:
   *"page of 2,000 exceeded the 30 s transaction budget; reduce
   BULK_OPERATION_PAGE_SIZE"*.

### How to validate

A fix is good when all four hold on a corpus of this shape — **not on a
throwaway namespace**, which cannot reproduce the failure:

```bash
# 0. a corpus where the page UPDATE is slow. Confirm the precondition first:
#    this must take >10s, or the test proves nothing. Run it three times —
#    the variance is the point, and a single fast run will mislead you.
psql -c "\timing on" -c "BEGIN;
  UPDATE findings SET status='RESOLVED', updated_at=now(),
    history = COALESCE(history,'[]'::jsonb) || '[{\"e\":\"SC\"}]'::jsonb
  WHERE id = ANY((SELECT array_agg(id) FROM (SELECT id FROM findings LIMIT 2000) s)::text[]);
 ROLLBACK;"

# 1. dry run
POST /custom-detectors/:id/retire-out-of-scope-findings  {"dryRun": true}
#    -> COMPLETED, counts.wouldRetire = N

# 2. retire
POST /custom-detectors/:id/retire-out-of-scope-findings
     {"dryRun": false, "fromOperationId": "<dry>", "expectedCount": N, "confirm": true}
```

| # | Must hold |
|---|---|
| 1 | Operation reaches `COMPLETED`, not `FAILED` |
| 2 | `changed == counts.wouldRetire` from the dry run |
| 3 | `SELECT count(*) FROM findings WHERE finding_type='<retired>' AND status='OPEN'` → **0** |
| 4 | Killing the worker mid-retire and restarting resumes and still satisfies 2 and 3 |

Regression test: assert the page write budget directly, so the pairing cannot
silently drift —

> a page of `BULK_OPERATION_PAGE_SIZE` rows must complete inside the
> transaction timeout, with margin, at a stated rows-per-second.

### Operational consequence for us

99,821 findings — **11% of this corpus** — are orphaned: the detector can no
longer produce them, and nothing can retire them. They still cost storage,
embeddings, evidence analyses and correlation work, and they still inflate
inquiry match counts.

---

## P2 — dev `max_connections` is below what the chart's own arithmetic requires

### What was not working

Before anything above could be tested, the worker was failing with:

```
Too many database connections opened: sorry, too many clients already
```

which left a `RETIRE_OUT_OF_SCOPE` operation `PENDING` with no progress, made
`FindingBulkOperationWorker` re-register its queue every few seconds, and backed
up `finding-stats-refresh`. One scan also died with `P2037`.

### Root cause

`values.yaml` states the rule:

> Worst case per pod is `poolMax × maxResidentNamespaces`; keep that (summed
> over API + worker replicas) under the server's `max_connections`. pg-boss
> holds a further 5 connections per active workspace outside these pools.

Live: `PRISMA_POOL_MAX=16` × 8 resident schemas × 2 pods = **256**, plus
pg-boss, against `max_connections` = **100** — the Postgres default, never set
in `helm/develop/values-dev.yaml`. Measured bursts to **92/100**.

Not caused by #284; #284 added enough concurrent background work (the bulk
operation worker, the runner asset-query service) to start reaching a ceiling
that was always too low.

### What was done

`max_connections: 200` added to `helm/develop/values-dev.yaml` with the
arithmetic recorded. Connection errors stopped immediately and the stuck
operation resumed on its own.

### What should still be done

- **Review the number.** 200 is ~2× measured demand, not the 256 worst case;
  each backend costs roughly 5 MB against a 3 Gi limit already spending 768 MB
  on `shared_buffers`.
- **Check production and VPS values against the same arithmetic.** If dev
  violated it, other environments may.
- **Consider failing loudly at boot** when `poolMax × maxResidentNamespaces ×
  pods` exceeds the server's `max_connections`. The rule is written down;
  nothing enforces it, and the symptom is a stuck queue rather than an error
  naming the cause.

### How to validate

```sql
SHOW max_connections;
SELECT count(*) FROM pg_stat_activity WHERE datname='classifyre';
```

Under a full scan plus a bulk operation, peak must stay under
`max_connections`, and the worker log must contain no `too many clients` over a
sustained run.

---

## P3 — pg-boss connection instability in other namespaces

Recurring in the worker log, 20 occurrences each in 20 minutes, for three
namespaces that are **not** the one under test:

```
pg-boss error [ns_a99a63c9027c4cef8b67256b79f4464f]:
AssertionError [ERR_ASSERTION]: Database connection is not opened
    at assertDb (pg-boss/dist/manager.js:812:13)
```

Not blocking here, but it is continuous noise that would mask a real failure,
and it suggests pg-boss instances for inactive or removed namespaces are being
kept and used after their connection is gone.

**Validate:** a worker running for an hour with several namespaces resident
produces no `assertDb` errors.

---

## P4 — `finding-stats-refresh` queue churn

368 jobs `created` to refresh **2** dirty days, with 5 stuck `active` from
before a restart. The rollup itself is current, so this is not stale data — but
it is a queue filling faster than it drains, and the stuck `active` entries
never expire.

**Validate:** `SELECT state, count(*) FROM pgboss_<ns>.job WHERE
name='finding-stats-refresh' GROUP BY 1` stays bounded over an hour of active
scanning, and no job stays `active` longer than its `expire_seconds`.

---

## P5 — bulk operation progress is misleading (minor)

Progress only updates at chunk boundaries. The final chunk of the retire dry run
sat at `99,806 processed / 344,064 of 351,156 blocks` for **eleven minutes**
before completing. Accurate, but indistinguishable from a hang while watching —
and we cancelled an earlier operation believing it was stuck.

**Suggestion:** update `blocksScanned` within a chunk, or expose
`lease_until` / last-heartbeat so a UI can distinguish "working" from "dead".

---

## Summary

| Item | State | Action |
|---|---|---|
| bug 0 | ✅ verified | — |
| #5 detector breaker | ✅ verified, ~10× | — |
| #6 discovery | ✅ verified | — |
| #7 background ops | ✅ verified, resumable | P5 (cosmetic) |
| #2 retire — dry run | ✅ counts exact | — |
| **#2 retire — execute** | ❌ **fails deterministically** | **P1** |
| #1 / #3 / #4 primitives | shipped, unused here | our migration |
| dev connection ceiling | ⚠️ fixed, needs review | P2 |
| pg-boss stability | ⚠️ noisy | P3 |
| stats queue | ⚠️ churn | P4 |
