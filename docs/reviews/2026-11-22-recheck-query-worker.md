# Re-review: query worker (628cac83, 56045f87, 8b5782ef)

- Diff: `git diff 617092b0...8b5782ef`
- Checks: [2026-11-21-query-worker-fixes-383fd5c4.md](2026-11-21-query-worker-fixes-383fd5c4.md), and before it [2026-11-21-query-worker-7281bbcc.md](2026-11-21-query-worker-7281bbcc.md)
- Checked by hand: the local-folder check (`session.py:94-128`) is a denylist of `/proc /sys /dev /etc /run /var/run /root` plus folders that contain a temp root. Only when `CLASSIFYRE_QUERY_LOCAL_ROOTS` is set does it also act as an allowlist.
  - Nothing in `docker/` sets that variable.
  - The all-in-one s6 `query-worker/run` sets no TMPDIR, so the worker's temp root is `/tmp`.
  - So `/var/lib/classifyre` is accepted as a source folder. It holds `masked-config.key` (`entrypoint.sh:243`), `iam.secrets` (`:305`) and the SQL TLS keys (`:358-360`), owned by the worker's own uid.

**Verdict: conditional.**

- **Helm:** ready for a first release only with trusted tenants, or one tenant per pool, and with `clusterCidrs` set.
- **Many untrusted workspaces sharing one pool:** not ready.
- **All-in-one image:** not ready while the local-folder allowlist is unset.

## Standards

### Tooling

- `ruff check`, `ruff format --check` and `mypy src/query` are clean.
- `bun check-types` and `eslint src/data-query src/cli-runner` are clean.
- `helm lint` has 0 failures.

### Earlier findings

Fixed:
- S12: drain is 960 in the code too (`worker.py:101,274`).
- The missing overflow-cap tests.
- The P8 lockdown tests.

Still open:
- `container_memory_mb` is both a field (`worker.py:281`) and a function (`:520`).
- "Every query slot is taken" is now written in 3 places (`query-worker.client.ts:186`, `query-run.service.ts:810`, `worker.py:647`).

### New

- **Soft breaches of CLAUDE.md "Write unit tests alongside implementation":**
  - `job_only` queries going through `mayStartJob` (`cli-runner.service.ts:2587`) has no test.
  - Forwarding `K8S_CLI_QUERY_LOCAL_ROOTS` (`kubernetes-cli-job.service.ts:844`) has no test.
- **Possible Duplicated Code:**
  - The over-cap throw (`query-run.service.ts:926`) repeats `assertBelowCap`'s `ConflictException` (`:825`). The gateway path then catches it and casts `getResponse()` (`:645`), which uses an exception for control flow.
  - `workspaceId: this.actors.workspaceId()` and its comment are written in both request builders (`:955`, `:1118`).
- **Possible Primitive Obsession:**
  - `JOB_CLAIM = 'claimed'` (`:138`) stores a sentinel in `jobName`, a column that otherwise holds a Job name.
  - The same code is written both `'too_many_queries'` and `'TOO_MANY_QUERIES'`.
- **Possible Shotgun Surgery:**
  - `deployment-query-worker.yaml:329` hard-codes the component list `[postgres, iam, sql-gateway, worker, query-worker]`.
  - The local-roots setting has two env names and three wiring sites (`_helpers.tpl`, the Deployment, `kubernetes-cli-job.service.ts:844`).

## Spec

### Status

| Id | Verdict | Evidence |
|---|---|---|
| P1 one uid | DECLARED OPEN | Unchanged |
| P2 all-in-one writable `/app` | DECLARED OPEN | — |
| P3 private directories | PARTIAL | Rests on P15, now mostly closed; the shared uid remains |
| P4 egress | PARTIAL | `deployment-query-worker.yaml:319-335`; see (a) |
| P5 memory guard | **FIXED** | `worker.py:520-547` reads `memory.current − inactive_file` (v1: `total_inactive_file`); per query it reads statm RSS − shared (`:508`); polls every 100 ms (`:100`) |
| P6 admission | PARTIAL | `query-run.service.ts:912-932`, `:792-811`; `worker.py:760-780`; see (b) |
| P7 cancel vs result | **FIXED** | `receiveResult` writes with `updateMany(settleable)` (`:1325-1398`) and audits only when `count > 0`. DQ R6 promises an audit only for a returned result, and a discarded result reaches nobody, so this is acceptable. |
| P8 isolation tests | **FIXED** | COPY, ATTACH, INSTALL and LOAD are refused (`test_query.py:1169-1179`); roots `/ /tmp /proc /etc/ssl /run` are refused (`:1184`). COPY into an allowed folder is not tested. |
| P9, P11, P12, P14, P16 | FIXED | Unchanged |
| P10 scope creep | NOT FIXED | Not a blocker |
| P13 GitOps token churn | DECLARED OPEN | — |
| P15 local roots / lockdown | PARTIAL | `session.py:107-128`, `:427-436`, `:499-501`; see (c) |
| P17 all-in-one dumpable API | DECLARED OPEN | — |
| New: ODBC Jobs uncapped | **FIXED** | `cli-runner.service.ts:2585-2587` |
| New: overflow cap passable by a burst | **FIXED** | Claim, then count, then release (`:794-811`). Each count runs after the run's own claim commits. |
| New: 3 s cancel-poll load | DECLARED OPEN | — |

### (a) P4: egress is still open to the whole cluster by default

Checked by rendering the chart with `queryWorker.enabled=true`.

- The new rule (`podSelector NotIn [postgres, iam, …]`) is added next to `ipBlock 0.0.0.0/0`. NetworkPolicy rules add up, so on CNIs that match pod IPs with `ipBlock` (Calico, for example) the database and the identity server are still reachable while `clusterCidrs: []`, which is the default.
- The kube API and the kubelet (node IPs) stay reachable even when `clusterCidrs` is set. Only `automountServiceAccountToken: false` softens that.
- An external database is reachable unless the operator lists it in `deniedEgressCidrs`.
- DNS works: CoreDNS pods carry no `component` label. NodeLocal DNS at 169.254.20.10 would be blocked, as it already was.
- **Fix:** make `clusterCidrs` required when `queryWorker.enabled` (a `fail` in the template), and document the kube API, node and external-database CIDRs for `deniedEgressCidrs`.

### (b) P6: the per-workspace share is per pod only

- The 75 % share lives in each pod's memory (`worker.py:573`). With three or more workspaces, two of them can fill a pod. The third then depends on 3 random retries plus overflow Jobs.
- There is still no cap per tenant and no global cap on Jobs (10 per workspace × N workspaces).
- A run refused after insert is kept as an ERROR row (`:915`), so it shows in history. Cosmetic.

### (c) P15: the local-folder check is a denylist unless an allowlist is configured

- **All-in-one image (high):**
  - `CLASSIFYRE_QUERY_LOCAL_ROOTS` is never set, so only the denylist applies.
  - `/var/lib/classifyre` is accepted. It holds `masked-config.key`, `iam.secrets` and the SQL TLS keys, owned by the worker's own uid. `/app` and `/home` are accepted too.
  - A workspace admin who adds a local folder at `/var/lib/classifyre` can read the key that decrypts every workspace's source credentials.
  - API validation (`validation.service.ts:72`) still accepts any absolute path, and all-in-one scans run without any lockdown.
  - **Fix:** set the allowlist in `entrypoint.sh` (the folders actually mounted for data), add `/var/lib/classifyre` and `/app` to the denylist, and run `check_local_root` in API validation and in scans as well.
- **Helm Jobs (low):** `setEnvValue` skips empty strings (`kubernetes-cli-job.service.ts:1595`). With `localFolders` empty, query Jobs get no allowlist, against "set, even empty". The impact is small because a Job pod runs one query.
- **Paths from `duckdb_databases()`** go into `allowed_paths` without `check_local_root` (`session.py:441`).
- **Order:** `_spatial`'s `DESCRIBE` in `relation()` runs before `check_local_root` (`:500`), so one schema read happens before the check.
- **Symlinks:** `realpath` is resolved at check time, but DuckDB follows symlinks inside an allowed folder. This matters only if users can write into the mounted folders.
- **HTTP allowlist:** built from every string in the recipe (`recipe_endpoints`). A workspace admin can name any host, and httpfs follows redirects. It is a real second wall against query users, not against admins. Prefix matching is safe: there is a trailing `/`, and `@` ends the host.

### (d) Lost-run settle is not tied to the token

The `settleable` condition does not include `callbackTokenHash`, so two concurrent results for a lost run could both be written and audited. Low.

### Tests

- **CLI:** `pytest tests/test_query_worker.py tests/test_query.py` gave **168 passed, 3 skipped, 1 failed**. The failure is `test_the_query_deadline_still_holds` (socket timeout) while the API tests ran at the same time; run alone it passes in 5.5 s, so it is **flaky under load**.
- **API, jest** (`bun run test`): **403 tests in 28 suites, all passing**.
- **API, `bun test`:** this uses Bun's own runner and fails one test, `query-worker.client.spec.ts:277`, because `jest.advanceTimersByTimeAsync` does not exist there. That file is not in this diff.

## What each open item needs before production

| Item | Acceptable for a first release if… |
|---|---|
| All-in-one local folders (c) | Not acceptable as is: set the allowlist and deny `/var/lib/classifyre` and `/app`. A small change. |
| P4 egress open by default | `clusterCidrs` is required (template `fail`) and the kube API, node and external-database CIDRs are documented for `deniedEgressCidrs`. |
| P1 one uid | The tenants on a pool trust each other, or there is one tenant per pool. The real fix is a pod per tenant, or user namespaces. |
| P2 / P17 all-in-one | The all-in-one image is single-tenant. Helm is not affected. |
| P6 no tenant or global cap | There are few tenants, and Jobs are bounded by a namespace ResourceQuota. |
| P13 token churn | Installs use `helm install`, or GitOps uses a fixed `existingSecret`. |
| 3 s cancel poll, thread per request | Under about 1k in-flight queries. |

**Summary:**

- **Standards:** no hard violations; 2 missing tests and about 6 judgement calls. Worst: `JOB_CLAIM` stores a sentinel in the `jobName` column.
- **Spec:**
  - Fixed: P5, P7, P8 and three of the new items.
  - Partial: P3, P4, P6 and P15.
  - Declared open: P1, P2, P13, P17 and the cancel poll.
  - Worst: in the all-in-one image, a workspace admin can point a local folder at `/var/lib/classifyre` and read the key that decrypts every workspace's source credentials.
