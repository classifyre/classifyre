# Review: warm query worker (7281bbcc)

- Diff: `git diff 7281bbcc^...7281bbcc` (30 files, +2911)
- Spec: POC `poc-payload/docs/isolation.md`, `src/fedsql/isolation.py`, `docs/poc-review.md`; `docs/prd/DQ-data-query.md`; `docs/prd/TEN-tenant-isolation-and-cloud.md`
- Question: is it production-ready, scalable and secure when different workspaces share one worker pool?
- Verdict: **no**. Each query process is set up well; the container, file system and admission around it are not.

## Standards

No hard violations. mypy, ruff and eslint are clean on the changed files, and `bun check-types` passes. The only lint hits are in `development/lakehouse-lab/bench_query.py:209,314`. Everything below is a judgement call.

**Security (CLAUDE.md "Security Considerations")**

- S1. The worker's security contexts come from `api.cliJobs.*SecurityContext` (`deployment-query-worker.yaml:64,168`): non-root uid 10001, drop ALL capabilities, no privilege escalation, RuntimeDefault seccomp. If an operator blanks those settings, the `{{- with }}` wrapper leaves this long-lived pod with no securityContext at all.
- S2. `readOnlyRootFilesystem: false` is inherited.
- CLAUDE.md says uid 1000, but the whole chart already uses 10001.
- Good: `automountServiceAccountToken: false`, `enableServiceLinks: false`, the s6 service runs as `classifyre` on 127.0.0.1, and the token is generated rather than committed.

**Other soft points**

- S3. `worker.py:532` uses one blocking thread per request (`ThreadingHTTPServer`), against "prefer async for I/O". Defensible here.
- S4. `query-worker.client.ts:105` reads `process.env` in the constructor instead of injecting config.
- S5. `query-run.service.ts:656,682,914` runs an `updateMany` over every workspace's runs before each admission count, against the API p95 < 1 s target.

**Smells**

- S6. Duplicated Code: the marker `'__CLASSIFYRE_QUERY_RESULT__'` is defined twice (`client.ts:6`, `query-run.service.ts:104`).
- S7. Duplicated Code: DuckDB memory per query is computed two different ways (`entrypoint.sh:275` vs `worker.py:226`).
- S8. Primitive Obsession / Repeated Switches: the outcome kinds (`done`, `timeout`, `cancelled`, `crashed`, `stopped`) are a plain `str` in Python, retyped by hand in TS, and switched on at `client.ts:236`.
- S9. Data Clumps: `{runId, request, timeoutSeconds}` is written out twice (`client.ts:130,148`).
- S10. Feature Envy: `on_signal` reads `worker._draining` directly (`worker.py:626`).
- S11. Mysterious Name: `ENV` holds a prefix (`worker.py:58`).
- S12. Shotgun Surgery: the defaults (port 8090, slots, drain 60) are repeated in four files.
- S13. `worker.py:264` imports the private `runner._error` and `runner._report`.
- S14. `# --` on every continuation line in `values.yaml` cuts the descriptions in the generated Helm README.

## Spec

**What was right**

- Each query runs in a new process from a fresh fork-server interpreter. That process gets only allowlisted environment variables, inherits no file descriptors, and gets a new DuckDB connection.
- The token check is constant-time.
- Retries happen only on a 503 sent before any work, so no query runs twice.
- The deadline is the timeout plus 60 s.

**(a) Missing or partial against the POC**

- P1. No container boundary. The POC says "Process isolation inside one container is not a security boundary".
  - The token comes in as an environment variable, so a copy stays in `/proc/1/environ`.
  - The main process is not dumpable-protected, and it holds every in-flight request, which carries every workspace's decrypted source credentials.
- P2. The root filesystem is writable, and the venv under `/app` is owned by uid 10001. One compromised query can change the code that later queries from other tenants import.
- P3. Spill directories and CA files sit in one shared `/tmp`. `process.kill()` on timeout, cancel or drain leaves them behind.
- P4. The NetworkPolicy is off by default, has ingress rules only, and its selector doesn't check the release label.
- P5. Memory per query is not enforced (Helm never sets `QUERY_MEMORY_MB`). One query running out of memory kills the pod and every other tenant's queries on it.
- P6. There is no admission cap per workspace or tenant; the cap per person is 100. Overflow Jobs are uncapped, and the HPA scales on CPU only.
- P7. The cancel/complete race (POC F07) is still open. `cancel()` overwrites the status unconditionally, and the `inFlight` map lives in one API pod, so a cancel on another API replica never reaches the worker.
- P8. The POC's isolation tests have no counterpart.

**(b) Scope creep**

- P9. The per-person cap went from 3 to 100 even with the worker off. The PRD says 20.
- P10. The extension-loading change in `duckdb_engine.py` is unrelated to the worker. The lost-run sweep and `bench_query.py` were also added.

**(c) Implemented but looks wrong**

- P11. The lost-run sweep counts 20 minutes from `createdAt` and clears `callbackTokenHash`. A late result is then refused, so data is read from the source with no audit record.
- P12. Drain is 60 s but queries can run for 900 s, so every rollout or scale-down kills long queries.
- P13. The token Secret is regenerated on every render under `helm template` or ArgoCD, and pods have no checksum annotation. The worker then answers 401 and the API silently falls back to Jobs.
- P14. `START_METHOD=fork` is accepted, so children would inherit the parent's memory.
- P15. DuckDB external access is left on in query sessions. Only the SQL gate stops `read_text('/proc/1/environ')` or reads of other queries' spill files.
- P16. ODBC `Driver=` paths are unrestricted, so they load native code next to other tenants' queries.
- P17. All-in-one image: the worker runs as the same uid as the API, so the API's database URL is readable through `/proc/<api>/environ`.

## Top blockers

1. Credentials can leak from the dumpable main process (P1).
2. Code can be rewritten across tenants on a writable root filesystem (P2).
3. External access is on and temp files are shared, so one query can read another's files (P3, P15).
4. No admission cap per workspace or tenant (P6).
5. Memory is not enforced per query (P5).
6. NetworkPolicy is off by default with no egress rules (P4).
