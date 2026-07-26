/**
 * Disposes of the run's namespace — or keeps it, when debugging.
 *
 * `E2E_DELETE_NAMESPACE=false` in apps/e2e/.env leaves the namespace and
 * everything the run created in it in place, and prints where to find it.
 */
import { request as playwrightRequest } from "@playwright/test";
import { TestNamespace, shouldDeleteNamespace } from "./namespace";

export default async function globalTeardown(): Promise<void> {
  const namespace = TestNamespace.restore();
  if (!namespace) {
    return;
  }

  if (!shouldDeleteNamespace()) {
    const baseUrl = process.env.BASE_URL || "http://localhost:3000";
    console.log(
      `\n[e2e] keeping namespace '${namespace.slug}' for inspection: ` +
        `${baseUrl}/${namespace.slug}/sources\n` +
        `[e2e] set E2E_DELETE_NAMESPACE=true to clean up on the next run\n`,
    );
    return;
  }

  const context = await playwrightRequest.newContext();
  try {
    await namespace.dispose(context);
    TestNamespace.clearState();
    console.log(`\n[e2e] namespace '${namespace.slug}' deleted\n`);
  } finally {
    await context.dispose();
  }
}
