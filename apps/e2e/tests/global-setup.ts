/**
 * Provisions the one namespace the whole run shares, before any spec starts.
 *
 * Specs read it back with `TestNamespace.shared()`; `global-teardown.ts`
 * decides whether to delete it (see `E2E_DELETE_NAMESPACE`).
 */
import { request as playwrightRequest } from "@playwright/test";
import { TestNamespace, shouldDeleteNamespace } from "./namespace";

export default async function globalSetup(): Promise<void> {
  const context = await playwrightRequest.newContext();
  try {
    // A leftover from an aborted run would silently be reused; start clean.
    TestNamespace.clearState();

    const namespace = await TestNamespace.create(
      context,
      process.env.E2E_NAMESPACE_PREFIX || "e2e",
    );
    namespace.persist();

    console.log(
      `\n[e2e] namespace '${namespace.slug}' created — ${
        shouldDeleteNamespace()
          ? "will be deleted after the run"
          : "will be KEPT (E2E_DELETE_NAMESPACE=false)"
      }\n`,
    );
  } finally {
    await context.dispose();
  }
}
