# Investigation Plan: Fix Prisma pg Deprecation Warning (CLASSIFYRE-9)

## Problem Analysis

### The Warning

```
(node:1) DeprecationWarning: Calling client.query() when the client is already
executing a query is deprecated and will be removed in pg@9.0. Use async/await
or an external async flow control mechanism instead.
```

This warning originates from the `pg` npm package (v8.19+). It fires when
`client.query()` is called on a `pg.Client` that already has an in-flight query.
The internal query queue that allowed this is being removed in `pg@9.0`, where
the same situation will throw an error instead of just warning.

### Root Causes (3 layers)

#### Primary: Prisma 7 PgTransaction without query serialization

Prisma 7.8.0's `@prisma/adapter-pg` (locked to **7.8.0** in `bun.lock`) uses a
`PgTransaction` class that acquires a single `pg.PoolClient` for the duration of
a Prisma transaction. When the query interpreter dispatches child queries (e.g.,
for `include`/join relations), it does so via `Promise.all` — triggering the
deprecation warning because multiple `client.query()` calls execute concurrently
on the same `PoolClient`.

- **Prisma issue**: https://github.com/prisma/prisma/issues/29407
- **Prisma fix PR**: https://github.com/prisma/prisma/pull/29468 (adds
  `async-mutex` to serialize queries in `PgTransaction.performIO`)

This fix has **not yet been released** in a stable version. The latest stable
release is 7.8.0; the 7.9.0-dev branch contains dev versions up to
`7.9.0-dev.13`.

#### Secondary: Explicit `Promise.all` inside a transaction callback

One location in the codebase explicitly runs concurrent queries on the
transaction client:

- **`apps/api/src/cli-runner/cli-runner.service.ts:1756`**:
  ```typescript
  const [errorCount, totalCount] = await Promise.all([
    tx.runnerAsset.count({ where: { runnerId, status: RunnerAssetStatus.ERROR } }),
    tx.runnerAsset.count({ where: { runnerId } }),
  ]);
  ```

This uses the same `tx` (single pg client) for two concurrent `count()` queries.
While this is only one site, it directly contributes to the warning.

#### Tertiary: Interactive transactions create single-client context

Every `$transaction(async (tx) => {...})` callback in the codebase uses a single
pg client internally. Even if our code does not use `Promise.all`, Prisma's own
`$transaction` array form
(e.g., `await this.prisma.$transaction([query1, query2])`) runs operations on a
single client. If any individual operation has join children dispatched via
`Promise.all` (the Prisma bug), the warning fires.

Files with interactive transaction callbacks:
- `asset.service.ts` (lines 1304, 1376, 1510)
- `cli-runner/cli-runner.service.ts` (11 locations)
- `case-threads.service.ts` (5 locations)
- `correlation/correlation.service.ts` (line 561)

### Impact Scope

The warning appears every time:
1. A Prisma transaction involves models with relation `include`/`select`
   (Prisma dispatches join children concurrently)
2. The `Promise.all` on line 1756 of `cli-runner.service.ts` runs
3. Any `$transaction` with multiple array elements runs

Since transactions are used pervasively (~62 `$transaction` references in `src/`),
the warning fires on most API write paths.

### How `pg` Is Used in This Codebase

| Usage | File | Version | Role |
|-------|------|---------|------|
| Direct dependency | `pg-stream.service.ts` | `pg@8.21.0` | CSV export streaming (own `pg.Pool`) |
| Bundled via Prisma | `@prisma/adapter-pg` | `pg@^8.16.3` (transitive) | Prisma ORM PostgreSQL driver |
| Bundled via pg-boss | `pg-boss` | (transitive) | Job queue |

The `pg-stream.service.ts` uses `client.query(new QueryStream(...))` with a
dedicated client per checkout — no concurrent queries on the same client. It is
**not** a source of the warning.

The `pg-boss` library (`^12.15.0`) creates its own pg connections. It could be
a secondary source but is unlikely since it's a mature library.

---

## Implementation Approach

### Step 1: Fix the explicit `Promise.all` inside transaction

**File**: `apps/api/src/cli-runner/cli-runner.service.ts:1740-1794`

Replace the `Promise.all` with sequential `await` calls:

```typescript
// Before (line 1756):
const [errorCount, totalCount] = await Promise.all([
  tx.runnerAsset.count({ where: { runnerId, status: RunnerAssetStatus.ERROR } }),
  tx.runnerAsset.count({ where: { runnerId } }),
]);

// After:
const errorCount = await tx.runnerAsset.count({
  where: { runnerId, status: RunnerAssetStatus.ERROR },
});
const totalCount = await tx.runnerAsset.count({ where: { runnerId } });
```

These two `count()` queries are independent but lightweight — sequential
execution adds negligible latency (both are indexed queries on `runnerId`).

### Step 2: Upgrade Prisma to latest patch (when available)

**File**: `apps/api/package.json`

Monitor for the Prisma 7.9.0 release which includes:
- PgTransaction mutex fix (PR #29468)
- Duplicate `values` parameter fix (PR #29650)

When released, update:
```json
"@prisma/adapter-pg": "^7.9.0",
"@prisma/client": "^7.9.0",
```

Then run `bun install` and `bun prisma:generate`.

### Step 3: Add `--no-deprecation` flag as temporary mitigation (optional)

In production Docker images, the warning floods logs. As a temporary measure
until Prisma 7.9.0 is released:

- **Option A**: Set `NODE_OPTIONS="--no-deprecation"` in the Docker
  container's environment (suppresses all deprecation warnings)
- **Option B**: Set `NODE_OPTIONS="--warnings=error"` to surface warnings as
  errors during development/testing (stricter)

If Option A is chosen, add it to the Dockerfile or Helm chart environment:
```yaml
env:
  - name: NODE_OPTIONS
    value: "--no-deprecation"
```

This should be documented as temporary and removed when Step 2 is completed.

### Step 4: Confirm `pg-stream.service.ts` is clean

**File**: `apps/api/src/export/pg-stream.service.ts`

The current implementation correctly gets a dedicated client, issues exactly one
`client.query()` (with `QueryStream`), and releases the client on completion or
error. No changes needed here.

However, add a safety comment noting that the `client.query()` call is the
single-query-per-client variant and should stay that way.

### Step 5: Review all `$transaction(array)` calls for relation `include`

**Files**:
- `asset.service.ts:696, 834` — `$transaction([findMany, count])`
- `notifications.service.ts:105` — `$transaction([findMany, count, count])`
- `findings.service.ts:403` — `$transaction([findMany, count])`
- `sandbox.service.ts:756` — `$transaction([findMany, count])`
- `cli-runner.service.ts:2899, 3317` — `$transaction([findMany, count])`

If any of these `findMany` calls include relation `include` or `select` blocks,
they would trigger the PgTransaction bug internally. Review each and consider
simplifying to avoid `include` inside transactions, or add comments tracking the
known Prisma issue.

**Verdict**: Most array-form transactions are simple `findMany + count` without
`include`. No changes expected here, but verification is needed.

---

## Caveats & Risks

### Risk 1: Prisma 7.9.0 release timeline unknown
The fix PRs (#29468, #29650) are merged into the `dev` branch but 7.9.0 has not
been released. We may need to wait weeks or months for a stable release.

**Mitigation**: Implement Steps 1 and 3 now (immediate relief). Step 2
(upgrade) is deferred but tracked.

### Risk 2: The warning may have multiple sources
While the PgTransaction bug is the most likely source, additional internal
Prisma code paths could also trigger concurrent `client.query()`.

**Mitigation**: Run the API with `node --trace-deprecation` to get stack traces
for each warning occurrence. This identifies exactly which code path is
responsible.

### Risk 3: `pg-boss` 12.x may also contribute
`pg-boss` uses `pg` internally. If pg-boss shares connections or reuses a
single client, it could also trigger the warning.

**Mitigation**: Check pg-boss logs; if the warning correlates with pg-boss
activity, consider upgrading pg-boss or checking its configuration for a
`max` pool setting.

### Risk 4: Dependency conflict when upgrading Prisma
`@prisma/adapter-pg@7.8.0` bundles `pg@^8.16.3`. If we keep the direct
`pg@8.21.0` dependency (for `pg-stream.service.ts`), we now have two pg
instances at different minor versions. This is already the case and should
not cause issues, but we must ensure the adapter-pg's bundled pg version is
compatible.

### Risk 5: No backward-compatibility concerns
The fix is purely internal — no API contracts, database schemas, or client
behaviors change.

---

## Verification Strategy

### Unit Tests

1. **`cli-runner.service.spec.ts`** — Verify the fix for line 1756:
   - The mock at line 69-70 handles `$transaction` callbacks correctly:
     ```typescript
     prisma.$transaction.mockImplementation((arg: any) =>
       Array.isArray(arg) ? Promise.all(arg) : arg(prisma),
     );
     ```
   - The mock already passes `tx` object for callback form; the inner
     `tx.runnerAsset.count` calls resolve to `0` (line 63).
   - Existing tests should pass without modification since the transaction
     callback behavior is unchanged.

2. Run the full test suite:
   ```bash
   cd apps/api && bun test
   ```

### Integration/E2E Tests

Run the existing e2e tests to confirm no regression in runner lifecycle:
```bash
cd apps/api && bun test:e2e
```

### Manual Verification

1. Start the API and observe startup logs:
   ```bash
   cd apps/api && bun dev
   ```
   - Check that no `DeprecationWarning` appears in the console output.
   - If running with `--trace-deprecation`, confirm the source is
     identified and addressed.

2. Trigger a runner complete + transition (the code path in Step 1):
   - POST to the runner completion endpoint
   - Verify no deprecation warning in logs

3. Trigger CSV export to verify `pg-stream.service.ts` is unaffected:
   - GET an export endpoint (e.g., `/api/assets/export`)
   - Verify CSV is produced correctly

### Linting & Typecheck

```bash
cd apps/api && bun lint && bun check-types
```

---

## Soundness Checklist

Before marking CLASSIFYRE-9 as done:

- [x] **Root cause understood**: Prisma 7's PgTransaction dispatches join
      children via `Promise.all` on a single pg client
- [x] **One explicit `Promise.all` inside transaction** identified and fixed
      (`cli-runner.service.ts:1756`)
- [ ] **Sequential count queries** produce correct results (order-independent)
- [ ] **No new ESLint or TypeScript errors** from the change
- [ ] **Existing tests pass** (unit + e2e)
- [ ] **No deprecation warning in API logs** when running through a full
      runner lifecycle (start, process assets, complete)
- [ ] **Prisma upgrade tracked** — either completed or a ticket/comment exists
      for when 7.9.0 drops
- [ ] **`NODE_OPTIONS=--no-deprecation`** (if used) is documented as temporary
- [ ] **Security**: No changes to authentication, authorization, or data access
- [ ] **Performance**: Sequential `count` queries add ~1-2ms latency per
      runner completion (negligible for a non-hot path)
- [ ] **Error handling**: The transaction callback's error path is unchanged
      (line 1793+ error handling still works)
- [ ] **Logging**: No new log messages added or removed
- [ ] **Confirms `pg-stream.service.ts` is clean**: No concurrent queries on
      a single client
