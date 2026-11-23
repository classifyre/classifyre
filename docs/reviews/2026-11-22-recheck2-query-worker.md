# Re-review 2: query worker, all-in-one and Helm (68c5d4ef)

- Diff: `git diff a7b0c72a...68c5d4ef` (14 files, +264/−51)
- Checks: [2026-11-22-recheck-query-worker.md](2026-11-22-recheck-query-worker.md)
- Checked by hand:
  - `queryWorker.enabled: true` by default (`values.yaml:698`) with `clusterCidrs: []` (`:812`), so a default `helm install` no longer renders.
  - The CI deploy values (`helm/develop/values-vps.yaml`, `values-vps-develop.yaml`, used by `.github/workflows/develop.yml:69,73`) don't set `clusterCidrs`.
  - `scripts/helm-snapshot.sh --check` fails with the new message.
  - `notebook-env.ts` keeps no `CLASSIFYRE_QUERY_*` variable.

**Verdict:**

- **Security:** the fixes hold.
- **Helm: not mergeable yet.** The chart no longer renders with its own defaults, the CI deploy values, or the repo's helm scripts.
- **All-in-one: ready for a single tenant,** with one medium gap in the fallback path.

## Standards

- **Tooling:** ruff, mypy, `bun check-types`, eslint and `helm lint -f values-dev.yaml` are clean. shellcheck is not installed.
- **Hard (repo script):** `scripts/helm-snapshot.sh --check` and `scripts/helm-validate.sh` fail at `deployment-query-worker.yaml:283`, because their values don't set `clusterCidrs`. CI doesn't run them, so nothing caught it.
- **Possible Duplicated Code, with high drift risk:**
  - The folder denylist is copied by hand: `local-folder-path.ts:10-23` and `local_roots.py:27-44` (the comment says "the same list").
  - The TypeScript side already differs: it lacks `_PRIVATE_NAMES` and the `tempfile.gettempdir()` root.
  - CLAUDE.md "Shared Schemas" puts data both languages read in `packages/schemas`. A JSON list there, or a spec that compares the two lists, would remove the drift.
- **Missing tests** (CLAUDE.md "Write unit tests alongside implementation"):
  - the `LOCAL_FOLDER` check on save (`validation.service.ts:83-93`);
  - the attached-catalog check (`session.py:410-412`);
  - the Helm `fail`;
  - `K8S_CLI_QUERY_LOCAL_ROOTS` with an empty value (`kubernetes-cli-job.service.ts:848`), whose behaviour this diff changed.
- **Not fixed from earlier:**
  - `_PRIVATE_NAMES` still copies `worker.QUERY_DIRS` (it moved to `local_roots.py:46`).
  - The local-roots setting now has 4 wiring sites (`entrypoint.sh:51` is new).
- **Possible dead code:** `session.py:96` `_env_paths` has no caller left.
- **Possible Mysterious Name:** `CLASSIFYRE_QUERY_LOCAL_ROOTS` now controls scans too (`local_folder/source.py:65`).
- **Possible Primitive Obsession:** `String(type).toUpperCase() === 'LOCAL_FOLDER'` (`validation.service.ts:88`) instead of the source-type enum.

## Spec

| Item | Verdict | Evidence |
|---|---|---|
| (c) All-in-one local folders | **FIXED** (one gap below) | `entrypoint.sh:51-52` exports `/data` before `exec /init`. The s6 scripts use `with-contenv`, and `s6-setuidgid` passes the environment through. The worker keeps `CLASSIFYRE_QUERY_*` (`worker.py:164`). Refused: `/var/lib/classifyre`, `/var/lib/postgresql`, `/app`, `/opt`, `/cache` (`local_roots.py:31`). |
| Key material at default locations | **Refused** | `masked-config.key`, `iam.secrets` and `sql-tls` are under `/var/lib/classifyre`; the worker token under `/run`; Postgres data under `/var/lib/postgresql`; Keycloak under `/opt`. |
| Helm Jobs, empty allowlist | **FIXED** | `kubernetes-cli-job.service.ts:844-851`, `_helpers.tpl:611`. Python treats empty as "nothing allowed" (`local_roots.py:61-66,81`). |
| `duckdb_databases()` paths | **FIXED** | `session.py:407-412`. The check runs after ATTACH, before user SQL. |
| DESCRIBE before the check | **FIXED** | `LocalFolderSource._root()` now runs the check before `_spatial` (`source.py:63-67`, `object_storage.py:38,98`). |
| Scans | **FIXED** | `source.py:63-67`. A refused folder fails the scan with a clear message (`test_local_roots.py:57`). |
| API check on save | **FIXED** | `validation.service.ts:83-93` covers create, update, bulk, MCP and Autopilot. Old sources saved as `/` are caught when they run. |
| P4 egress | **FIXED, under its condition** | The render fails without `clusterCidrs` (`deployment-query-worker.yaml:282-284`). The `0.0.0.0/0` rule excepts 169.254/16 plus the cluster CIDRs. The kube API and nodes are reachable unless listed in `deniedEgressCidrs`; that is documented (`values.yaml:804-811`). |

### Blocker: the chart no longer renders where it is used

The worker is on by default and `clusterCidrs` is empty by default, so these all fail:
- a default `helm install`;
- the CI deploy (`values-vps.yaml`, `values-vps-develop.yaml`);
- `scripts/helm-snapshot.sh --check`;
- `scripts/helm-validate.sh`.

Fix:
1. Add the k3s CIDRs (10.42.0.0/16, 10.43.0.0/16) to both VPS values files and to the scripts' common arguments, and regenerate the snapshot.
2. Decide what a default install should do. Either turn `queryWorker.networkPolicy.enabled` off by default with a warning in NOTES, or keep the `fail` and say so in the chart README's install section.

### Medium: the allowlist is lost when the API runs the query itself (all-in-one)

- When the worker is busy or unreachable, or when `QUERY_WORKER_ENABLED=false`, the API starts the query with `buildNotebookEnvironment` (`cli-runner.service.ts:2624`).
- Its list of kept variables (`notebook-env.ts:18-71`) leaves out `CLASSIFYRE_QUERY_LOCAL_ROOTS`.
- In that path only the denylist applies, so `/home`, `/usr`, `/srv` and `/mnt` can be read. The key material stays refused.
- Fix: keep `CLASSIFYRE_QUERY_*` in `notebook-env.ts`, and add a spec for it.

### Low

- Moving `CLASSIFYRE_KEY_FILE`, `CLASSIFYRE_IAM_SECRETS_FILE` or `CLASSIFYRE_SQL_TLS_DIR` elsewhere does not add the new place to the refused list. Only the `/data` allowlist protects them. Refuse the directories those variables name, or document that they must stay outside `/data`.
- `networkPolicy.enabled=false` renders no NetworkPolicy and prints no warning in NOTES.
- Symlinks inside `/data`: DuckDB follows them. This matters only if someone can write into `/data`; the README mounts it `:ro`.

The declared-open items (P1, P2/P17, P6, P13, cancel poll, thread per request) keep the conditions from the previous review.

### Tests

| Check | Result |
|---|---|
| `pytest test_query.py -k "local or root or lockdown or folder"` | 13 passed |
| `test_local_roots.py` | 8 passed |
| `test_query_worker.py` (not re-run by the author) | 27 passed, 3 skipped |
| API jest (`cli-runner`, `sources`, `local-folder-path`) | 17 suites, 260 passed |
| `helm template` without `clusterCidrs` | fails with a clear message |
| `helm template` with `clusterCidrs` | renders; IPv4 `except` is `[169.254/16, 10.42/16, 10.43/16]` |
| `helm template -f values-dev.yaml` | renders |
| `helm-snapshot --check`, `helm-validate.sh`, VPS values | **fail** on `clusterCidrs` |

**Summary:**

- **Standards:** 1 hard failure (the helm scripts), 4 missing tests and about 6 judgement calls. Worst: the denylist is hand-copied between Python and TypeScript and already differs.
- **Spec:** all 8 items fixed or fixed under their condition; 1 blocker, 1 medium and 3 low. Worst: the chart no longer renders with its defaults or the CI deploy values.
