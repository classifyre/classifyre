# Desktop memory and the API heap ceiling

The desktop app runs the Classifyre API as a child process of Electron. That
process has a V8 heap ceiling, and when it is exceeded the process aborts with
`SIGABRT` — which macOS reports as **"classifyre-desktop quit unexpectedly"**
even though the Electron window itself never died. The supervisor restarts the
API automatically, so the visible symptom is a crash dialog and an interrupted
scan rather than a dead app.

This page covers how the ceiling is chosen, how to raise it, and how to tell
whether raising it is actually the right move.

## Changing the limit

**Settings ▸ API Memory Limit** (macOS: the Classifyre application menu;
Windows and Linux: the top-level Settings menu).

| Choice | Meaning |
| --- | --- |
| Automatic (recommended) | Sized by the app — see below. This is the default. |
| 3 GB | Fixed 3072 MB ceiling. |
| 4 GB (maximum) | Fixed 4096 MB ceiling. The highest value Electron will grant. |

The choice is per installation, not per workspace, and persists in
`settings.json` (`memoryLimitMb`, where `0` means automatic) alongside the
embedded database in the app's data directory. It applies when the API process
next starts, so the menu offers an immediate restart; declining simply defers
it to the next launch.

The setting is native rather than part of the in-app settings pages on purpose:
it configures the local API *process*, and it has to stay reachable when that
process is unhealthy — which is precisely when someone goes looking for it.

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

Two hard limits are worth knowing:

- **Electron clamps `--max-old-space-size` to ~4 GB** under
  `ELECTRON_RUN_AS_NODE`. Requesting 6144 or 12288 both yield a real
  `heap_size_limit` of 4192 MB. The app never requests more than it can get,
  because anything derived from the request (notably the backpressure
  threshold) would otherwise be computed against a ceiling that does not exist.
- **Desktop runs `SERVICE_ROLE=all`**: one process is both the HTTP API and
  every background worker. In Kubernetes those are separate pods at 1536 MB
  each (`api.maxOldSpaceSizeMb`), which is why the desktop default is higher
  than the server one.

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

Check the log before changing anything — **Logs ▸ Open Log File**, or:

```bash
grep -E "FATAL ERROR|Last few GCs|Heap guard" ~/Library/Application\ Support/Classifyre/logs/main.log
```

Every API boot logs the ceiling it actually got and the threshold at which it
starts shedding work:

```
Heap guard: shedding CLI ingestion above 1638 MB of a 2048 MB V8 ceiling (derived)
```

## How many workspaces scan at once

`MAX_CONCURRENT_NAMESPACE_JOBS` caps how many workspaces run background jobs
simultaneously. The API default is **4**, sized for Kubernetes where every
worker is its own pod with its own memory limit. Desktop overrides it to 2 (3
on 12+ cores) because one process serves every workspace here, and each
namespace job spawns a CLI with its own detector pool — at 4 that is up to
4 × `CLASSIFYRE_MAX_POOL_WORKERS` resident Python workers (~1 GB apiece for
spaCy + torch) plus four ingest streams allocating into a single V8 heap.

Measured on a laptop before the override: a sawtooth from 384 MB to 3435 MB
every ~90 seconds, with `Namespace 'sec-edgar' acquired worker slot 4/4` while
other workspaces queued behind it.

## OCR and torch.compile

The CLI disables `torch.compile` (`TORCH_COMPILE_DISABLE=1`, set in
`src/utils/torch_runtime.py` before torch is imported). Inductor generates C++
and shells out to a compiler at scan time, which needs a toolchain the desktop
bundle and slim container images do not promise — and it builds the compiler
command without quoting paths, so the desktop venv under
`~/Library/Application Support/…` breaks it at the space:

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

  This used to be a 20-minute healthy-uptime timer — twice the window — which
  could never fire for a service crashing more often than that, i.e. exactly
  the service that needed it. Observed on a real install: three crashes inside
  90 seconds, then eight minutes of healthy service, and that fourth death
  retired the API for the session because the three timestamps were still
  inside the 10-minute window.

## Related

- `apps/desktop/src/main/process-manager.ts` — `computeApiHeapMb`, spawn flags
- `apps/api/src/utils/heap-guard.ts` — threshold derivation
- `apps/cli/src/outputs/rest.py` — retry policy
- `apps/desktop/README.md` — data storage and settings file
