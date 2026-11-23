# Review 1: SQL gateway and BI client fixes

- Diff: `git diff c4ed4ae6...cdf6d07b` (the files reviewed are the same at HEAD)
- Commits:
  - `356a9152` fix(query): qualified column names
  - `60a16b9b` fix(sql-gateway): pooled sign-ins wait; busy instead of OOM
  - `493fba5d` fix(sql-gateway): paged reads no longer cut short; ODBC cursors
  - `cdf6d07b` test(bi-smoke)
- Spec:
  - `docs/prd/BIC-bi-client-compatibility.md`. The open items in §9 are left out: bool_and, TimeZone, SHOW ssl, trace cut, Npgsql, skaffold profile, M6, M10, M11.
  - `docs/prd/DQ-data-query.md`.
  - POC `docs/bi-compatibility.md`, `bi-test-plan.md`, `poc-review.md`.
  - The author's reviewer guide.
- Checked by hand: the DECLARE regex in `sql-text.ts:189-193` is anchored and only accepts options in a fixed order. A statement it doesn't match is "left to PGlite" (doc comment at `sql-text.ts:180-182`).

**Verdict: changes requested.**

- `_qualify_columns` is sound; no bypass was found.
- The cursor work can still return 0 rows without an error.
- Cursors and sign-in waits give one session or one address ways to starve every tenant.

## Standards

### Tooling at HEAD

- `bun check-types` is clean.
- `ruff check`, `ruff format --check` and `mypy` are clean on `gate.py` and `test_query.py`.

### Documented-standard violations

- **`development/bi-smoke/bi_smoke.py:59, :504`, low severity (dev only).** Breaks *CLAUDE.md Security: "Never commit credentials or API keys"*.
  - `:59`: `MB_PASSWORD = "bi-smoke-" + "metabase-1"`. The split literal looks like it is meant to slip past secret scanners.
  - `:504`: `token("admin", "admin")`.
  - Follow `scripts/smoke/seed.sh`: read from env or a Secret, or generate with `openssl rand`.
- **`bi_smoke.py`, judgement call.** 74 lines are over 100 characters, and all I/O is synchronous. Those rules are written for the CLI (`apps/cli/pyproject.toml`), and this file is outside `apps/cli`.
- **`sql-gateway.service.ts:324, :745`, judgement call.** `sessionMemoryConfig()` reads `process.env` in a field initialiser, and `process.memoryUsage()` is called directly. Neither goes through constructor DI. The existing `loadConfig()` does the same.

New logic comes with `.spec.ts` tests (memory-guard, sign-in, sql-text, integration), and everything uses async/await.

### Smells (judgement calls)

- **Possible Duplicated Code:**
  - `pg-session.ts:92` (`DataCursor`) vs `Portal`, and `:561` vs `:663`: both hold `fields/rows/truncated/offset` and page through them with the same steps (slice, `sendRows`, advance the offset, `tooMany` when truncated). Extract one buffered-result pager.
  - `gate.py:292` and `:304` repeat `parts = (rename or {}).get(...) or (...)` plus three `to_identifier(..., quoted=True)` calls. The `shown = mapped or ….sql(...)` plus `table_not_available` refusal is at both `:225` and `:287`.
  - `const rowsOf` is defined twice in `pg-session.integration.spec.ts` (`:331`, `:370`).
  - `UNDER_PRESSURE_MAX_RSS_BYTES` is parsed twice, with different defaults: `main.ts:180` uses 1 GB, `memory-guard.ts:26` treats unset as "no limit".
- **Possible Data Clumps:**
  - `keys` and `release` (plus `signedIn`) go together into a nine-parameter `signInTo` (`sql-gateway.service.ts:656`). `lockout.begin` could return one `{ keys, release }` claim.
  - `database`, `search_path` and `allowed` travel together into both `_postgres_name` and `_qualify_columns` (`gate.py:259`).
- **Possible Shotgun Surgery:** the gateway's limits now live in two places, `maxSessions` in `loadConfig()` and the memory ceiling in `memory-guard.ts:22-29`.
- **Possible Mysterious Name:** `CURSOR_NAME.slice(1, -1)` (`sql-text.ts:200`) strips a capture group's parentheses by character position. Give the non-capturing pattern its own name.

## Spec

### (a) Missing or partial

- **BIC1 tests not delivered, and §9 doesn't list them as open.**
  - §6.2 asks for `test_query_bi_dialect.py`, `pg-types.agreement.spec.ts` plus `arrow-types.json`, and *"A Describe of every `data` statement starts **no** run (F05)"*. None of these exist.
  - The corpus replay (`pg-session.integration.spec.ts`) uses a fake runner and node-pg's simple protocol. The gate rewrite, DuckDB execution, Describe-without-run and DECLARE/FETCH are never replayed.
  - The psqlODBC fixture holds the bare SELECT, not the `declare … cursor with hold for` the driver actually sends.
  - On the guide's question: the fixture replay is only a partial regression net.
- **Memory policy is not in Helm** (guide: *"Should it go into the Helm values?"*).
  - `values.yaml:854-855` still says "about 150 MB per session" and `maxSessions: 16`, but the code assumes 450 MB (`memory-guard.ts:28`).
  - At the default `limits.memory: 4Gi` with an 87.5% ceiling, the guard caps the pod at about 6 sessions, and nothing says so.
  - `SQL_GATEWAY_SESSION_MEMORY_MB` can only be set as an env var.

### (b) Scope creep

None of substance. The bi-smoke harness is part of BIC0.

### (c) Looks implemented, likely wrong

1. **D5 still returns 0 rows without an error** (spec: *"the gateway must serve FETCH from the run's result"*). Anything the anchored `DECLARE_CURSOR` regex doesn't match goes to PGlite's empty tables:
   - a leading comment (`-- x\nDECLARE …`), which `splitStatements` keeps;
   - options in another order (`DECLARE c SCROLL BINARY CURSOR`);
   - a DECLARE sent through Parse/Bind/Execute: `parse()` (`pg-session.ts:592`) classifies on the first keyword, DECLARE is not in `READING_KEYWORDS`, so the statement gets no tables.

   The FETCH then returns 0 rows and reports success. That is the silent truncation this commit set out to remove. **A DECLARE whose inner query reads data and isn't served must be refused.**
2. **SCROLL is accepted, not refused** (guide: *"are backward FETCH and SCROLL refused cleanly?"*). `DECLARE … SCROLL CURSOR` is served as forward-only. A later `FETCH BACKWARD/PRIOR/ABSOLUTE` reaches PGlite as 34000 "cursor does not exist", which is misleading and aborts the transaction. Refuse SCROLL at DECLARE with a clear 0A000.
3. **Cursor lifetime and transaction state** (guide: *"check transaction state and when cursors are dropped"*):
   - Non-hold cursors are dropped only at the end of a simple query in state `I` (`:492-496`). They are not dropped after an extended-protocol COMMIT, or on the early `return` after `failSimple`.
   - A WITH HOLD cursor survives a ROLLBACK.
   - A FETCH in an aborted (`E`) transaction is still served.
   - A duplicate name silently replaces the old cursor; PostgreSQL raises 42P03.
4. **One session can starve every tenant:**
   - WITH HOLD cursors each hold up to `maxRows` (or `export_max_rows`) materialised rows in the API heap, and nothing limits how many a session opens (`:532`).
   - The memory guard checks RSS only at sign-in, and only for sessions still starting (`memory-guard.ts:34-40`). Sessions already admitted can grow from about 150 to about 400 MB, and their cursors without bound, until the pod runs out of memory.
   - There is no per-workspace share: one tenant with two connections fills the roughly 6 slots.
   - Fix: count cursor rows against the session's budget, and cap open cursors per session.
5. **The sign-in wait makes a cross-tenant DoS easier.** The guide's checks pass:
   - two sign-ins never overlap;
   - a failure is counted before `release()` (`service.ts:737`);
   - `release` is idempotent and always reached through `finally`;
   - the 10 s timeout does refuse.

   The problem is the key, `ip:${client}` (`service.ts:~580`), which has no workspace in it.
   - Waiters now hold one of the 64 global pre-auth slots for up to 10 s (`sign-in.ts:131`); before this they were refused at once.
   - A client that stalls SCRAM keeps the key for the full 20 s `SIGN_IN_MS`.
   - So one address with no credentials (the unknown-workspace decoy path works) can fill `MAX_SIGNING_IN` and block sign-ins for every tenant.
   - Behind SNAT or without PROXY protocol, tenants also queue behind each other.
   - Minor: a waiter that times out leaves its `done` in `waiting` until the next `end()`.
   - Fix: cap waiters per address, and keep waiting sign-ins out of the global pre-auth count.

### Gate: `_qualify_columns` (356a9152)

Probed: 4-part `lab."src.sch".t.c`, 5-part struct paths, `"__src_x.main".t.c`, CTE names equal to a table, mixed case, `x."src.sch".t.c`, `(c.addr).city` and `"src.sch".t.*`. All were rewritten or refused correctly. The rewrite only writes names of tables that are allowed and read, so masking views stay in the path. **No bypass found.**

Nit: `c.addr.city` is refused as `table_not_available` (42501), where PostgreSQL would answer 42P01.

### bi-smoke cleanup (cdf6d07b)

Cleanup runs in reverse order and is skipped with `--keep`. The persona, grants, connections and exposures are all undone. Gaps:

- If the second grant POST fails, the earlier grants are never added to cleanup (`bi_smoke.py:545-551`).
- Left behind:
  - the Keycloak group;
  - the `bi-smoke-drivers-spec` secret, which holds connection passwords (the connections are revoked, so they no longer work);
  - the CA configmap;
  - the viewer Metabase database.

## Merge order of fixes

1. Refuse any DECLARE over data that isn't served, so it never returns 0 rows (c1).
2. Cap cursors per session, or count them against the session's memory (c4).
3. Cap waiting sign-ins per address (c5).
4. Follow-ups, listed in BIC §9 if deferred: cursor lifetime (c3), SCROLL (c2), Helm values for the memory policy, the missing BIC1 tests.

**Summary:**

- **Standards:** 1 low-severity hard violation (dev-only credentials in `bi_smoke.py`) and about 10 judgement calls. Worst: two parsers of `UNDER_PRESSURE_MAX_RSS_BYTES` with different defaults.
- **Spec:** 2 missing or partial, 5 wrong, and the gate is clean. Worst: a DECLARE the regex doesn't match returns 0 rows without an error.
