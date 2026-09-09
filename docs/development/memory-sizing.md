# Memory sizing and the API heap ceiling

The API is a Node process with a V8 heap ceiling. When it is exceeded the
process aborts — `FATAL ERROR: Ineffective mark-compacts`, exit 139 — and
whatever is supervising it restarts it, so the visible symptom is an
interrupted scan rather than a dead deployment. This is *not* the same failure
as the container being OOM-killed by its cgroup, and the two are fixed
differently.

This page covers how the ceiling is chosen, how to change it, and how to tell
whether changing it is actually the right move. It was written from a long
sequence of real heap incidents; the measurements in it are from production
installs, not from theory.

## Changing the limit

The ceiling is `--max-old-space-size`, passed through `NODE_OPTIONS`. Nothing
derives it for you if that variable is empty — V8 then picks a default near
512 MB and the API dies partway through the first substantial ingest.

- **All-in-one Docker image**: `docker/entrypoint.sh` computes it from the
  container's real memory limit and prints what it chose at startup. Override
  with `CLASSIFYRE_NODE_HEAP_MB`.
- **Helm**: `api.maxOldSpaceSizeMb` and `worker.maxOldSpaceSizeMb`
  (`_helpers.tpl` renders them into `NODE_OPTIONS`). The chart *fails the
  render* if the heap ceiling reaches the RSS backpressure guard — see
  "What protects the process" below for why that combination is unusable.
- **Local development**: `NODE_OPTIONS` in your shell.

`SERVICE_ROLE=all` — one process serving HTTP *and* running the background
workers, which is what the all-in-one image does — needs more headroom than
either role alone, which is why its default sits above the chart's `api` value.

## Why bigger is usually worse

The instinct is that a crash with "heap out of memory" means the heap is too
small. On this code path that is usually backwards.

V8 schedules garbage collection against the ceiling it is given. A larger
ceiling means more garbage accumulates before a major GC runs. Measured on a
34 GB laptop mid-scan, with the ceiling at 4 GB:

- `old_space` sat at **3.1 GB**, while a forced full GC dropped the heap to
  **174 MB** — over 90% of it was collectable garbage, not live data.
- `rss` was **414 MB** against a **3237 MB** heap, because the operating system
  had compressed and swapped out the cold garbage pages. System-wide swap use
  reached 30 GB.
- The eventual crash was not "heap full". It was a single allocation failing
  under that memory pressure: `CALL_AND_RETRY_LAST Allocation failed`.

So a bigger heap bought more swap thrash and the same crash. The automatic
value is deliberately modest and deliberately **does not scale with installed
RAM** — a 128 GB workstation gets the same ceiling as a 16 GB laptop, because
the working set is a property of the workload, not of the machine.

Two things are worth knowing:

- **Never derive anything from the heap size you *requested*.** A runtime may
  grant less than you asked for, and a backpressure threshold computed against
  a ceiling that does not exist can never fire — the process aborts instead of
  shedding. `heap-guard.ts` reads `v8.getHeapStatistics().heap_size_limit`, the
  ceiling actually in force, for exactly this reason. (The bug that taught us
  this: Electron silently clamped a 6144 MB request to 4192 MB.)
- **`SERVICE_ROLE=all` runs both roles in one process** — the HTTP API and
  every background worker. That is what the all-in-one image does. In
  Kubernetes those are separate pods at 1536 MB
  each (`api.maxOldSpaceSizeMb`), which is why the all-in-one image's default
  is higher than the chart's `api` value.

## When raising it *is* right

There is one failure that a larger ceiling genuinely fixes: a live working set
that does not fit. The two cases look different in the log.

| Log line | Meaning | Raising the limit helps? |
| --- | --- | --- |
| `Ineffective mark-compacts near heap limit` | GC ran and could not free enough. The data is genuinely live. | **Yes** |
| `CALL_AND_RETRY_LAST Allocation failed` | An allocation failed with collectable garbage still on the heap, typically under system memory pressure. | No — usually the opposite |

The known case for the first is a very large workspace: reading a correlation
graph snapshot expands a 25 MB JSONB payload (58k nodes / 252k edges on a real
corpus) into a ~233 MB JSON string plus its parsed object tree, all live for
the duration of the request. If a workspace is large enough to hit that, raise
the limit to 3 or 4 GB.

### The correlation graph

The graph is the largest single thing the API holds, and it grows with the
corpus. Three things keep it survivable, and each has a lever:

- **Reads** forward the stored JSON straight to the response instead of parsing
  it into objects and serializing it back (~2× less heap per request).
- **Writes** serialize once, explicitly, rather than handing the whole object
  tree to the database client's parameter encoder. Every publish logs the
  payload size:

  ```
  Published correlation graph snapshot v322 (61570 nodes, 272667 edges, 233 MB, 21867 ms)
  ```

  Watch that MB figure. A JS string cannot exceed ~512 MB regardless of how
  much memory the machine has, so once it reads in the hundreds the answer is a
  scoped or paginated graph, not a larger heap.
- **Recomputes do not rebuild.** A correlation recompute marks the snapshot
  stale and returns; the rebuild happens once, later, in the coalesced refresh
  job. Rebuilding inline was the single largest memory event in the API — a
  whole-graph assembly per changed asset, invisible to the coalescing below
  because it never enqueued a refresh job.
- **Hub values are filtered out.** `CORRELATION_GRAPH_MAX_FANOUT` (default 10)
  drops shared values bound to more than N assets from the *unscoped* graph. A
  value held by hundreds of documents — a company name, a boilerplate footer —
  connects everything to everything and carries no signal; the Fingerprints UI
  already ranks values rarest-first for that reason. On a real corpus this kept
  92% of distinct values while dropping half the edges. Scoped views
  (`?assetId=`, `?sourceId=`) are never filtered — there the question is "what
  touches this thing", and hiding an edge would be wrong. Set `0` to disable.
- **Rebuild cadence** is coalesced by `CORRELATION_GRAPH_COALESCE_SECONDS`
  (default 180). A rebuild takes 13–24 seconds on a large corpus, and an active
  scan invalidates correlation continuously; with too short a window the API
  rebuilds the graph back-to-back for the whole scan. Reads stay correct while
  the window is open — a stale read serves the last-good snapshot and schedules
  a refresh — so the cost is a graph that lags a running scan by a few minutes.
  Lower it only if that lag matters more than headroom.

Check the log before changing anything:

```bash
docker logs classifyre 2>&1 | grep -E "FATAL ERROR|Last few GCs|Heap guard"
# on Kubernetes: kubectl logs deploy/classifyre-api | grep -E "FATAL ERROR|Heap guard"
```

Every API boot logs the ceiling it actually got and the threshold at which it
starts shedding work:

```
Heap guard: shedding CLI ingestion above 1638 MB of a 2048 MB V8 ceiling (derived)
```

## How many workspaces scan at once

`MAX_CONCURRENT_NAMESPACE_JOBS` caps how many workspaces run background jobs
simultaneously. The API default is **4**, sized for Kubernetes where every
worker is its own pod with its own memory limit. The all-in-one image lowers it
to 1-2 because one process serves every workspace there, and each
namespace job spawns a CLI with its own detector pool — at 4 that is up to
4 × `CLASSIFYRE_MAX_POOL_WORKERS` resident Python workers (~1 GB apiece for
spaCy + torch) plus four ingest streams allocating into a single V8 heap.

Measured on a laptop before the override: a sawtooth from 384 MB to 3435 MB
every ~90 seconds, with `Namespace 'sec-edgar' acquired worker slot 4/4` while
other workspaces queued behind it.

## OCR and torch.compile

The CLI disables `torch.compile` (`TORCH_COMPILE_DISABLE=1`, set in
`src/utils/torch_runtime.py` before torch is imported). Inductor generates C++
and shells out to a compiler at scan time, which needs a toolchain slim
container images do not promise — and it builds the compiler command without
quoting paths, so any venv living under a path with a space in it breaks:

```
clang++: error: no such file or directory: 'Support/Classifyre/…/torch/lib'
```

Docling falls back to eager execution, so this was never a visible failure —
just 167 compile errors and 33 OCR extractions returning no text on one
install. Measured on a single image with warm models: **58.5s compiling and
failing versus 24.9s with compilation off**, identical extracted text.

Set `TORCH_COMPILE_DISABLE` explicitly to override, if a deployment has a
toolchain, space-free paths, and a measured reason to want inductor.

## What protects the process

The API does not simply run until it dies:

- **Backpressure.** Above 80% of the real ceiling, bulk-ingest requests are
  rejected with `503` instead of being admitted and allocating. The threshold
  is derived from `v8.getHeapStatistics()` at boot, so it is correct on any
  machine, OS, or container limit without per-host tuning.
- **The CLI holds, it does not drop.** A `503` is retried with exponential
  backoff for roughly 30 minutes, honouring `Retry-After`. Bulk ingest is an
  idempotent upsert, so a retry re-sends the same batch safely; scan data is
  not lost when the API sheds, only delayed.
- **Bounded log capture.** A scan's stdout/stderr is retained as a bounded
  excerpt rather than in full, so retention does not grow with corpus size or
  scan duration.
- **Restart supervision.** A crashed API is restarted up to 3 times in 10
  minutes. Forgiveness is judged from the dead process's own uptime: a
  generation that served for 5 minutes or more was not boot-looping, so the
  earlier burst stops counting and it restarts on a fresh budget. Only deaths
  that keep happening *during boot* exhaust it.
- **The embedding worker is expendable.** Inference runs in a forked child, so
  onnxruntime aborting natively takes only that child with it — see below.

## A crash that is not the API

A crash in the logs does **not** always mean the API died. The embedding worker
is a *forked child* of the API, running the same Node binary, so a native abort
inside it looks very much like the parent dying. Tell them apart before
investigating:

| Signature | What died | Impact |
| --- | --- | --- |
| `FATAL ERROR: Ineffective mark-compacts` | the API's V8 heap | scan interrupted; the supervisor restarts it |
| `worker exited with code null (signal SIGTRAP)` | the embedding worker | that batch fails and is retried; **the API keeps serving** |

The distinction matters because the fixes are opposite: the first is a heap
sizing problem, the second is host memory pressure that raising the heap makes
*worse*. Where crash reports carry a parent pid, read that rather than the
process name — both processes are the same binary, and only the parentage
separates them.

Measured on 2026-08-22 on one install: five of eight recent crash reports were
the forked embedding child, not the API (onnxruntime `Tensor::Tensor` on the
faulting thread). The containment worked every time — and nothing in the
product said so, which is the actual problem. Since then
`GET /embeddings/status` also reports `workerCrashCount`, `lastWorkerCrashAt`,
`consecutiveWorkerFailures` and `breakerTrips`, so repeated native aborts are
visible without reading `.ips` files.

The `SIGTRAP` is onnxruntime's allocator aborting when the host cannot satisfy
a request — a machine-level pressure symptom, not a bug in the batch. It is
already mitigated (`enableCpuMemArena: false`, `intraOpNumThreads` bounded) and
inputs are truncated to the model's window by the pipeline, so the remaining
trigger is genuine system pressure. Check swap before looking for a code cause:

```bash
sysctl vm.swapusage
```

Three consecutive worker failures pause local embedding, then it retries on a
backoff (1, 2, 4… minutes, capped at 15) and resumes on the first batch that
succeeds. `GET /embeddings/status` reports `workerDisabled` and `workerRetryAt`.
The pause used to be permanent for the process, which meant one bad minute
silently ended semantic embedding until the app was restarted.

  This used to be a 20-minute healthy-uptime timer — twice the window — which
  could never fire for a service crashing more often than that, i.e. exactly
  the service that needed it. Observed on a real install: three crashes inside
  90 seconds, then eight minutes of healthy service, and that fourth death
  retired the API for the session because the three timestamps were still
  inside the 10-minute window.

## Related

- `docker/entrypoint.sh` — how the all-in-one image sizes the heap, Postgres
  and scan concurrency from the container's limits
- `helm/classifyre/templates/_helpers.tpl` — the chart's `NODE_OPTIONS` and the
  render-time guard against an unusable heap/RSS pair
- `apps/api/src/utils/heap-guard.ts` — threshold derivation
- `apps/cli/src/outputs/rest.py` — retry policy
