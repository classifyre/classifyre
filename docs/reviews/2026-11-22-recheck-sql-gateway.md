# Re-review: SQL gateway and BI smoke (617092b0)

- Diff: `git diff fe5a4a37...617092b0` (17 files, +599/−75)
- Checks: [2026-11-21-sql-gateway-bi-fixes.md](2026-11-21-sql-gateway-bi-fixes.md)
- Checked by hand: the per-address sign-in cap reads `raw.remoteAddress` (`sql-gateway.service.ts:414`) before the PROXY header is parsed (`:458-468`).

**Verdict: not ready.** The cursor refusal is now fail-closed for cursor statements. But the new per-address cap counts the proxy instead of the client, which makes the sign-in denial of service worse behind a load balancer. Three smaller cursor issues remain.

## Standards

### Tooling

- `bun check-types` and `eslint src/sql-gateway` are clean.
- `helm lint` has 0 failures.

### Earlier findings

Fixed:
- **the hard violation:** `bi_smoke.py` reads credentials from env or a random Secret; a grep finds no password literal. Nit: the Metabase password still goes on kubectl argv (`:81`).
- the two `UNDER_PRESSURE_MAX_RSS_BYTES` parsers are now one (`utils/heap-guard.ts:101` `rssGuardBytes`), with the different defaults documented;
- `CURSOR_NAME.slice`;
- the memory policy is in Helm (`values.yaml:854-865` `sessionMemoryMb`).

Accepted as skipped: the duplicated pager and the long `signInTo` parameter list.

### New

- **Soft breaches of CLAUDE.md "Write unit tests alongside implementation":**
  - the per-address sign-in cap (`sql-gateway.service.ts:415-432`) has no test;
  - `rssGuardBytes` has no test (`heap-guard.spec.ts` doesn't cover it);
  - the 8-cursor cap is never hit by a test, because the spec reaches the row budget first.
- **Possible Duplicated Code:**
  - the same add/decrement/delete counter-map logic is in `sign-in.ts:148-168` and `sql-gateway.service.ts:415-432`;
  - `extendedCursorRefusal`'s `close` branch equals its fall-through (`pg-session.ts:831-838`).
- **Possible Repeated Switches:** `cursor.kind` / `verb === 'DECLARE'` is branched on in `cursorStatement`, `unsupportedCursor` (`:659`) and `extendedCursorRefusal` (`:829`).
- **Possible Shotgun Surgery:** the two per-address limits live in two files, `MAX_WAITERS_PER_KEY = 8` (`sign-in.ts:87`) and `MAX_SIGNING_IN_PER_ADDRESS = 16` (`service.ts:96`).
- **Possible Mysterious Name:** `moveTo` (`pg-session.ts:386`), `pending` (`:104`), `LAST_NAME` (`sql-text.ts:221`). An orphaned `failExtended` JSDoc sits above `extendedCursorRefusal` (`:806`).

## Spec

### Earlier findings

| Id | Verdict | Evidence |
|---|---|---|
| (a) BIC1 tests | DEFERRED to §9 | BIC §9 "Still open" |
| (a) memory policy in Helm | **FIXED** | `values.yaml:854-865`, `deployment-sql-gateway.yaml:125` |
| c1 unserved DECLARE gives 0 rows | **FIXED for cursor statements** | `pg-session.ts:549,813`. Probes: every DECLARE the parser can't read is refused with 0A000, including `FOR(…)`, `DECLARE/**/c`, a DECLARE mid-batch and Parse/Bind/Execute. Leading or nested comments and any option order are served. |
| c2 SCROLL / backward / MOVE | **FIXED** | `:638`. SCROLL, `-1`, ABSOLUTE, PRIOR and MOVE all give 0A000 in both protocols. |
| c3 cursor lifetime | **PARTIAL** | Duplicate name gives 42P03 and FETCH in state E gives 25P02, both correct. Extended-protocol ROLLBACK is not detected (see 2). |
| c4 cursor cap | **FIXED, with a gap** | `:585,645`. The cap is in rows, not bytes: up to 2 × `exportMaxRows` per session, times 16 sessions per pod. |
| c5 sign-in DoS | **PARTIAL, and regressed** | See 1. Waiters still take global pre-auth slots, so 64 / 16 = 4 addresses fill `MAX_SIGNING_IN`. |
| bi-smoke cleanup | **PARTIAL** | See 5. |

### Blockers

1. **The per-address cap counts the proxy, not the client (regression, high).**
   - The cap uses `raw.remoteAddress` (`:414`) before the PROXY header names the client (`:468`).
   - With `proxyProtocol` on (any cloud load balancer), every client shares one set of 16 sign-in slots.
   - So one client holding 16 idle sockets blocks sign-ins for every tenant for 20 s, and can repeat it.
   - Fix: apply the cap after the PROXY header is parsed, keyed by the proxied client address. Also keep waiters out of the global `MAX_SIGNING_IN` count; that was the original c5 fix.
2. **A WITH HOLD cursor survives an extended-protocol ROLLBACK.**
   - The ROLLBACK's CommandComplete comes in the Execute reply and the ReadyForQuery in the Sync reply, so `rolledBack` is lost between them.
   - Probe: `BEGIN`, `DECLARE h … WITH HOLD`, then Parse/Bind/Execute `ROLLBACK`, then `FETCH ALL h` returns 2 rows.
   - The commit message claims "either protocol"; this probe shows otherwise. Track ROLLBACK across Execute and Sync.
3. **`FETCH 0` and `FETCH FORWARD 0` answer 0 rows without an error.** PostgreSQL re-fetches the current row. This is the same "0 rows as if it were the result" class as c1. Refuse it.
4. **Fail-open paths outside cursors** (older, not introduced here, and not in §9). Each of these reached PGlite and answered 0 rows with no error:
   - `PREPARE p AS SELECT … orders; EXECUTE p`
   - `CREATE TEMP TABLE x AS …` followed by `SELECT * FROM x`
   - a plpgsql `pg_temp` function
   - `COPY (…) TO STDOUT`

   Either refuse `EXECUTE`/`COPY` and revoke TEMP, or list them in BIC §9 as open.

### Smaller

5. **bi-smoke cleanup:**
   - `drop_persona` resets `ORG` to the first organization (`bi_smoke.py:229`), not `default`, so the group is left behind when there are several organizations.
   - Cleanup is registered after each create (`:587`), so a `make_persona` that fails partway leaves the user and group behind.
6. **Fidelity gaps** (list them in §9):
   - `ROLLBACK TO SAVEPOINT` keeps a data cursor;
   - duplicate-name checks ignore PGlite's own cursors;
   - `FETCH 1 c -- x` gives 34000;
   - `CLOSE c -- x` doesn't close;
   - a plain DECLARE outside a transaction runs a query job (PostgreSQL refuses with 25P01).

### §9 deferrals

Acceptable for merge: the BIC1 dialect and type-agreement tests, cursors through the extended protocol (that path now fails closed), the per-workspace session share, and the memory guard after admission. All are tracked.

### Tests

- `bun test -- src/sql-gateway`: **92 pass, 0 fail** (238 expects, 8 files).
- `bun check-types`: clean.
- Probes:
  - `/private/tmp/claude-501/-Users-andre-development-classifyre/68eddcfd-01ed-4561-8fb4-31afd63880d9/scratchpad/probe.spec.ts`
  - `/private/tmp/claude-501/-Users-andre-development-classifyre/68eddcfd-01ed-4561-8fb4-31afd63880d9/scratchpad/parse-probe.ts`

**Summary:**

- **Standards:** no hard violations (the earlier one is fixed); 3 missing tests and about 6 judgement calls. Worst: the per-address cap has no test, which is how its proxy bug got through.
- **Spec:** 4 fixed, 3 partial, 4 blockers. Worst: behind a PROXY-protocol load balancer, the per-address cap lets one client block every tenant's sign-ins.
