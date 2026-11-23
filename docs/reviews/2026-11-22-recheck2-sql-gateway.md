# Re-review 2: SQL gateway (a7b0c72a)

- Diff: `git diff a0e423b5...a7b0c72a` (11 files, +347/−49)
- Checks: [2026-11-22-recheck-sql-gateway.md](2026-11-22-recheck-sql-gateway.md)
- Checked by hand:
  - `unservedRead` (`pg-session.ts:438-472`) strips only leading comments (`withoutLeadingComments`), then matches regexes anchored at the start.
  - When `classifyre.reads` can't plan a statement, it returns NULL (`pglite-host.ts:23`), and `readsOf` turns that into "reads nothing" (`if (length < 0) return []`).
  - Only `DO`, `CREATE`, `PREPARE`, `EXECUTE` and `COPY` are checked. INSERT, UPDATE, DELETE and MERGE are not.

**Verdict: not ready.** The four earlier blockers are fixed in their plain form. But the check that should refuse "a read PGlite would answer empty" fails open: when it can't plan a statement it lets it through, and a comment after the first word gets past it. Several statement shapes still return 0 rows without an error, and BIC §9 now says none does.

## Standards

- **Tooling:** `bun check-types` and eslint are clean.
- **Earlier findings:**
  - **Fixed:** the per-address cap now has a test (`sign-in-slots.spec.ts`), and the counter map lives only in `SignInSlots`.
  - **Not fixed:** the two per-address limits still live in two files: `MAX_WAITERS_PER_KEY` (`sign-in.ts:87`) and `MAX_SIGNING_IN_PER_CLIENT` (`sign-in-slots.ts:13`).
- **Missing test:** the new `MAX_WAITERS = 256` cap (`sign-in.ts:154`) is never hit by a test.
- **Possible Middle Man:** `sql-gateway.service.ts:413-420` wraps `ticket` only to add `clearTimeout`.
- **Possible Long Parameter List:** `lockout.begin(keys, undefined, undefined, cb)` (`:587`). An options object would avoid that.
- **Possible Repeated Switches:** `unservedRead` (`pg-session.ts:438`) is a third statement classifier, next to `classify` and `extendedCursorRefusal`.

## Spec

| Item | Verdict | Evidence |
|---|---|---|
| B1 cap counts the proxy | **FIXED** | `identify()` runs after the PROXY header is parsed (`sql-gateway.service.ts:452`). With PROXY off it applies at once. Waiters leave the global count. |
| B2 extended ROLLBACK keeps WITH HOLD | **FIXED** | `pg-session.ts:373`. Probed with Parse/Execute `ROLLBACK`, `ABORT`, `COMMIT` in a failed block and `END`: each then gives 34000. |
| B3 `FETCH 0` | **FIXED** | `pg-session.ts:678`. `FETCH 0`, `FORWARD 0` and `RELATIVE 0` give 0A000. |
| B4 fail-open statements outside cursors | **PARTIAL (blocker)** | See below. |
| bi-smoke cleanup | **FIXED** | `bi_smoke.py:197` uses the `default` organization; cleanup is registered before the persona is made (`:586`). |
| Fidelity gaps in §9 | **FIXED** | All six are listed. |

### Blocker: statements that still return 0 rows without an error

With `T = "shop.public".orders`, each of these answers empty with no error:

- **A comment after the first word:**
  - `CREATE /*x*/ FUNCTION pg_temp.f() RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM T'`, then `SELECT pg_temp.f()` returns **0**. The plpgsql form with `EXECUTE format(...)` does too, and so does `CREATE OR REPLACE\n--c\nFUNCTION …`.
  - `COPY /*x*/ (SELECT * FROM T) TO STDOUT`, `COPY --c\n(…) TO STDOUT` and `COPY /*x*/ T TO STDOUT` each start CopyOut with 0 rows.
- **Verbs the check doesn't cover:**
  - `CREATE TEMP TABLE lk (LIKE T)`, then `INSERT INTO lk SELECT * FROM T RETURNING *` returns 0 rows.
  - `UPDATE u SET id=o.id FROM T o RETURNING o.*` and `DELETE FROM u USING T o RETURNING o.*` return 0 rows.
  - `MERGE … USING T` inserts nothing.
  - `CREATE RULE … DO ALSO INSERT INTO r2 SELECT id FROM T` leaves `r2` empty.
- **Built-in functions that run SQL text,** so the table never appears in the plan:
  - `SELECT table_to_xml('T'::regclass,false,false,'')` returns an empty `<orders>`;
  - `SELECT * FROM ts_stat('SELECT to_tsvector(customer) FROM T')` returns 0 rows;
  - the `query_to_xml` family behaves the same.
- **Minor:** `EXPLAIN ANALYZE SELECT * FROM T` reports `rows=0`.

**Correctly refused:**
- `PREPARE /*x*/` and `PREPARE "my p"`, because `EXECUTE` is refused;
- PREPARE through Parse;
- `DO` blocks, with comments too;
- a materialized view;
- CREATE TABLE AS through Parse;
- SELECT INTO;
- a DECLARE inside a multi-statement query.

`CREATE TEMP VIEW v`, then `SELECT * FROM v`, goes to the query job and errors there instead of returning 0 rows.

**Fix (make the check fail closed):**
1. When `reads` returns NULL (the plan probe failed), refuse in `unservedRead` instead of treating it as "reads nothing".
2. Strip all comments, not just leading ones, before matching the verbs.
3. Run INSERT, UPDATE, DELETE, MERGE and CREATE RULE through the same check, or refuse writes on a SQL connection outright, since it is read-only by design.
4. In the PGlite setup, revoke EXECUTE on `table_to_xml`, `query_to_xml`, `cursor_to_xml` and `ts_stat` (and their relatives) from the session role.
5. Correct BIC §9's "none returns 0 rows silently" until this is closed.

### Should fix, or record in §9: idle startup packets fill the global sign-in slots

- After `identify()`, a socket that stalls in the startup packet still holds one of the 64 global slots for the full 20 s.
- So 4 client addresses × 16 sockets lock out every tenant, and can repeat it every 20 s.
- Addresses are keyed in full, with no IPv6 /64 grouping, so a single IPv6 host can do this alone.
- There is no separate timeout for the PROXY header.
- The 256-waiter cap is shared by all tenants; filling it takes 32 addresses.
- Fix: a short startup-packet timeout (e.g. 5 s), and IPv6 grouped by /64.

### Tests

- `bun run test -- src/sql-gateway` (jest): **99 passed**, 9 suites.
- `bun check-types`: clean.
- Probes:
  - `/private/tmp/claude-501/-Users-andre-development-classifyre/68eddcfd-01ed-4561-8fb4-31afd63880d9/scratchpad/probe2.spec.ts`
  - `/private/tmp/claude-501/-Users-andre-development-classifyre/68eddcfd-01ed-4561-8fb4-31afd63880d9/scratchpad/probe3.spec.ts`
  - Output: `probe2.out` and `probe3.out` in the same folder.

**Summary:**

- **Standards:** no hard violations; 1 missing test and 4 judgement calls. Worst: the two per-address limits still live in two files.
- **Spec:** 5 fixed, 1 partial (the blocker), 1 should-fix. Worst: a statement the check can't plan, or one with a comment after its first word (`CREATE /*x*/ FUNCTION`), still returns 0 rows without an error.
