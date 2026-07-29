import { config } from 'dotenv';
import { resolve } from 'path';
// Safe to import statically: every DATABASE_URL read in this module happens
// inside a function, so nothing is captured before the env is loaded below.
import { applyAllPendingMigrations } from '../src/database-migrations';

/**
 * Jest globalSetup for the API integration suite: bring every schema the tests
 * will touch up to date before the first app boots.
 *
 * The suite boots `AppModule` directly through `Test.createTestingModule`, which
 * skips `main.ts` — and `main.ts` is the only place that calls
 * `applyAllPendingMigrations()`. Namespace schemas were therefore migrated
 * exactly once, by `deployForSchema` inside `NamespaceRegistryService.create`,
 * and never again. Any namespace that already existed (a reused integration
 * schema, a shared database, a `prepare` step that did not run) kept whatever
 * shape it had on the day it was created, so the first migration to add a
 * column broke the suite with `The column sources.<new column> does not exist`
 * — a failure with nothing to do with the test that reported it.
 *
 * Running the same orchestrator the server runs makes the two paths agree:
 * it bootstraps `public.namespaces` and deploys pending migrations into every
 * registered namespace schema. On a freshly prepared schema there are no
 * namespaces yet and this is a no-op; the namespace created later by the test
 * is migrated on creation as before.
 */
export default async function globalSetup(): Promise<void> {
  // globalSetup runs before `setupFiles`, so the env it relies on is not loaded
  // yet. Same order and precedence as test/setup-env.ts: repo defaults first,
  // test overrides after, and anything already in the process env wins (CI and
  // scripts/run-integration-tests.sh both export DATABASE_URL deliberately).
  const preserved = new Map(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  config({ path: resolve(__dirname, '../.env') });
  config({ path: resolve(__dirname, '../.env.test'), override: true });
  config({ path: resolve(__dirname, '../.env.test.local'), override: true });
  for (const [key, value] of preserved) process.env[key] = value;

  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL must be set for the API integration suite. ' +
        'Run via `bun run test:integration:run`, which prepares an isolated schema first.',
    );
  }

  await applyAllPendingMigrations();
}
