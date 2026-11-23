# Review: query worker fixes for a shared pool (383fd5c4)

- Diff: `git diff 805e4947...383fd5c4` (40 files, +1470/−322)
- Checks: the earlier review [2026-11-21-query-worker-7281bbcc.md](2026-11-21-query-worker-7281bbcc.md), findings S1–S14 and P1–P17
- Spec: POC `poc-payload/docs/isolation.md`, `docs/poc-review.md`; `docs/prd/DQ-data-query.md`; `docs/prd/TEN-tenant-isolation-and-cloud.md`
- Checked by hand: the P15 claim that a source's local root goes into `allowed_directories` unrestricted (`session.py:350-351`, `object_storage.py:83-88`), and that `CLASSIFYRE_QUERY_LOCAL_ROOTS` is not set anywhere in `helm/` or `docker/`.

**Verdict: much better, but not yet ready for many workspaces sharing one pool.**

- Fixed: P9, P11, P12, P14 and P16.
- Most of the rest are partly fixed.
- The remaining blockers:
  - a source's local root can open the DuckDB lockdown;
  - admission is not atomic and not fair between workspaces;
  - the memory guard counts page cache.

## Standards

### Tooling

- `ruff check` and `ruff format --check` are clean on the 12 changed CLI files.
- `mypy src/query` finds no issues in 21 files.
- `bun check-types` exits 0.
- `bench_query.py` only had RUF046 fixed. EXE001 and BLE001 were already there.

### Hard violations

None.

### Status of S1–S14

| Status | Findings |
|---|---|
| Fixed | S1, S2 (`deployment-query-worker.yaml:69,180`), S6, S7, S9, S10, S11, S13, S14 |
| Partial | **S5**: the lost-run sweep now runs once a minute, but new counts and a 3 s poll add database load. **S8**: Python now has `OutcomeKind`, but TS `WorkerOutcome` is still copied by hand, and the switch is still there. |
| Open | S3 (`worker.py:767`, a thread per request) |
| Worse | **S4**: the constructor still reads `process.env` and now also reads files. **S12**: drain is 960 in `values.yaml` but 60 in `worker.py:270,315`. 1536, 90 and the ODBC values are each written twice (`values.yaml:94,98,104`). |

### Standards, judgement calls

- **Tests alongside implementation.** No spec covers:
  - the overflow-Job cap: `overflowRefusal` (`query-run.service.ts:772`) and the `mayStartJob` branch (`cli-runner.service.ts:2585`);
  - accepting a late result on a `lost` run (`:1269`).
- **Async I/O.** `token()` calls `fs.statSync` and `readFileSync` on every request (`query-worker.client.ts:196`).
- **Pooling / p95.** Each admission runs two to three `count`s (`:743`, `:775`). Every running worker query polls `findUnique` every 3 s (`client.ts:221`, `service.ts:785`).
- **Sandbox.** The token Secret is mounted `defaultMode: 0444` (`_helpers.tpl:98`), so query processes can read it.

### Smells (judgement calls)

- **Possible Duplicated Code:**
  - The token-reload-on-change logic is in both `worker.py:223` and `client.ts:196`.
  - `MIN_TOKEN_LENGTH` is a constant, but the message at `client.ts:99` hard-codes "16".
  - "Every query slot is taken…" is in both `client.ts:186` and `query-run.service.ts:780`.
  - `CLI_BAKED_GROUPS` is word for word in both Dockerfiles (`Dockerfile:148`, `cli-dev-image/Dockerfile:20`).
  - The security-context defaults are in both `values.yaml:775` and the inline `dict`s in the template.
- **Possible Primitive Obsession:**
  - The `"://" in path` test decides "remote or local" in four places (`session.py:72,359`, `object_storage.py:88`, `attached_catalog.py:39`).
  - `(run.error as {code?})?.code === LOST_CODE` (`service.ts:1269`) checks a bare string.
- **Possible Repeated Switches:** the not-taken code is a nested ternary (`client.ts:257`), and Python has its own copy of the same strings.
- **Possible Mysterious Name:**
  - `_Running.memory_mb` (`worker.py:531`) holds the size a query was stopped at; `WorkerConfig.memory_mb` holds the planned budget.
  - `container_memory_mb` is both a config field (the limit, `:277`) and a function returning current usage (`:505`).
- **Possible Feature Envy / Message Chain:** `getattr(self.source.instance(), "_connection", None)("data_path")` (`attached_catalog.py:37-38`) reaches into a private attribute.
- **Possible Shotgun Surgery:** a new queryable source type needs edits in `_SOURCE_GROUPS`, both Dockerfiles and `src/sources/<type>`. `test_query_manifest.py` catches a miss.
- **Mutating config:** `config.token = value` (`client.ts:203`) changes the object the client got at construction.

## Spec

### Status of P1–P17

| Id | Verdict | Evidence at 383fd5c4 |
|---|---|---|
| P1 | PARTIAL | The token is a file now (Deployment env, s6 `run`). `set_not_dumpable` runs at `worker.py:850`, after `from_env` reads the token (`:904`), but before any query, so that is harmless. A failed `prctl` only logs a warning (`:369`). Every process shares one uid, so a query can kill the host or other queries. |
| P2 | PARTIAL | Helm defaults to `readOnlyRootFilesystem: true`, and an emptied value falls back to it. A partly filled `containerSecurityContext` drops it. The all-in-one image still has a writable `/app` owned by 10001 (`Dockerfile:266`). |
| P3 | PARTIAL | Each query gets a 0700 `mkdtemp` directory (`worker.py:640`), which the host removes after a kill (`:668`) and at start (`:560`). The uid is shared, so 0700 does not separate queries; that rests on P15. |
| P4 | PARTIAL | On by default, with ingress limited to this release. Egress denies 169.254/16, fe80::/10 and fd00:ec2::254. It allows `namespaceSelector: {}` (every pod in the cluster) and every other IP, including the database, the kube API and the kubelet. |
| P5 | PARTIAL | The guard exists. The pod-level check reads `memory.current` (`worker.py:508`); see (c). |
| P6 | PARTIAL | 200 per workspace (`query-run.service.ts:758`) and 10 overflow Jobs per workspace (`:772`). There is no tenant or pool cap. |
| P7 | PARTIAL | Cancel and start are conditional now. `receiveResult` still uses an unconditional `update` (about `:1285`, `:1314`), so a result can overwrite a cancel. Cancels reach other replicas through a 3 s poll per in-flight query (`client.ts:19`). |
| P8 | PARTIAL | New tests cover the lockdown, the token, the private directory and the memory guard. Nothing tests a COPY, ATTACH or INSTALL escape, or a source root of `/`. |
| P9 | FIXED | 20 without the worker, 100 with it. |
| P10 | NOT FIXED | Not addressed, and more was added (see b). |
| P11 | FIXED | Lost after 30 min; the token is kept, so a late result is still recorded and audited. |
| P12 | FIXED | Drain 960 s; the grace period is 980 s, which covers the 5 s preStop. |
| P13 | PARTIAL | Both sides re-read the token file when it changes. Under `helm template` or GitOps, every sync still makes a new token, so queries get 401 and fall back to Jobs for up to one kubelet sync period. |
| P14 | FIXED | `worker.py:301` refuses `fork`. |
| P15 | PARTIAL | The lockdown runs before user SQL (`session.py:363-364`, `:560`, `:616`), but it can be opened; see (c). |
| P16 | FIXED | ODBC queries go to Jobs (`worker.py:593`). |
| P17 | NOT FIXED | In the all-in-one image the API (node) runs as `classifyre`, can be dumped, and has `DATABASE_URL` in its environment (s6 `api/run`). |

### (a) Missing or partial against the spec

- **P6, caps not atomic:** the count happens before the insert, with no lock across API replicas.
- **P6, overflow cap does not hold under a burst:** `overflowRefusal` counts runs with `jobName` set, but `jobName` is only written in `onJobCreated`. A burst passes the check before any Job is counted.
- **P6, no fairness:** the default pool is 8 slots × 5 replicas = 40. That is far below 200 per workspace and 100 per person, so one workspace, or even one person, can take every slot.
- **P4:** egress is open to everything in the cluster apart from link-local.
- **P1, "Process isolation inside one container is not a security boundary" (POC):** still true, because every process shares one uid.

### (b) Not asked for (scope creep)

- Every source client is baked into the CLI image, which makes it bigger for every scan Job too.
- The BLAS thread pools are pinned to one thread.
- `bench_query.py` grew.
- The dev image re-syncs its dependency groups.

### (c) Implemented but looks wrong

- **P15, the lockdown can be opened from a source's configuration:**
  - A LOCAL_FOLDER path can be any absolute path (`validation.service.ts:72`).
  - That root goes into `allowed_directories` as is (`object_storage.py:83-88`, `session.py:350-351`), and so does a DuckLake `data_path`.
  - A workspace admin who sets the path to `/` or `/tmp` turns the lockdown off for their queries. Those queries can then read other queries' private directories.
  - Fix: refuse local roots outside an operator allowlist, and refuse roots that contain the worker's tmp directory.
- **P15, a setting nobody sets:** `CLASSIFYRE_QUERY_LOCAL_ROOTS` is read (`session.py:61,350`), but nothing in `helm/` or `docker/` sets it, although its comment says the chart does.
- **P15, remote URLs left open:** `http://` and `https://` stay allowed. Behind the SQL gate, that is a path into in-cluster HTTP services; P4 does not close it.
- **P5, guard measures the wrong number:**
  - `memory.current` includes page cache, so spilling to the disk-backed `/tmp` pushes it towards the limit, and the guard kills queries that are not using too much memory. It should read the working set (`memory.current − inactive_file`).
  - A 250 ms poll (`:100`) can lose to the kernel's OOM killer.
  - The per-query cap is 1536 MiB × 8 slots, about 12 GiB, against a 4 GiB pod.
- **New: ODBC Jobs are uncapped.** `job_only` queries skip `mayStartJob` (`cli-runner.service.ts:2585`), so ODBC Jobs are limited only by the 200 cap.
- **New: cancel-poll load.** One database read per in-flight query every 3 s, per replica. That is about 670 qps at 2,000 in-flight queries.
- The token file is mounted 0444. Low impact.

## Remaining blockers for many workspaces, in order

1. A source's local root can open the DuckDB lockdown (P15).
2. Admission is not atomic; there is no pool or tenant fairness; the overflow cap can be bypassed by a burst or by ODBC (P6).
3. The memory guard counts page cache and kills healthy queries, and its 250 ms poll can lose to the OOM killer (P5).
4. One shared uid: a query can kill the worker host and every workspace's queries (P1).
5. Egress is open to the whole cluster, and `http(s)://` is allowed inside DuckDB (P4, P15).
6. The all-in-one image: dumpable API and writable `/app` (P17, P2).
7. A result can overwrite a cancel (P7).
8. Token churn under GitOps (P13).

**Summary:**

- **Standards:** no hard violations; about 20 judgement calls. 9 of S1–S14 are fixed, and S4 and S12 got worse. The worst: drain is 960 in Helm but still 60 in the code.
- **Spec:** 5 of 17 earlier findings fixed, 10 partial, 2 not fixed, plus about 8 new issues. The worst: a workspace admin can widen the DuckDB lockdown through a source's local root.
