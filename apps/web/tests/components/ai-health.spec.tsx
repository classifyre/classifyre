import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";
import { AiHealthProvider, AiHealthFixButton } from "@/components/ai-health";
import { ServerConfigContext } from "@/components/server-config-provider";

type CtPage = Parameters<Parameters<typeof test>[2]>[0]["page"];

/**
 * Records every call to the AI provider endpoints. The demo-mode contract is
 * that the health probe is never issued at all — a demo visitor cannot fix a
 * provider, and the probe itself is a POST the read-only guard rejects.
 */
async function trackProviderCalls(page: CtPage) {
  const calls: string[] = [];

  await page.route("**/ai-provider-configs**", async (route) => {
    calls.push(new URL(route.request().url()).pathname);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });

  return { calls };
}

test("demo mode issues no provider probe and renders no fix banner", async ({
  mount,
  page,
}) => {
  const { calls } = await trackProviderCalls(page);

  const component = await mount(
    <ServerConfigContext.Provider
      value={{ s3Configured: false, demoMode: true }}
    >
      <AiHealthProvider>
        <AiHealthFixButton />
      </AiHealthProvider>
    </ServerConfigContext.Provider>,
  );

  // Long enough that the effect would have fired had it been going to.
  await page.waitForTimeout(700);

  expect(calls).toEqual([]);
  await expect(component.getByRole("link")).toHaveCount(0);
});

test("outside demo mode the provider is probed", async ({ mount, page }) => {
  const { calls } = await trackProviderCalls(page);

  await mount(
    <ServerConfigContext.Provider
      value={{ s3Configured: false, demoMode: false }}
    >
      <AiHealthProvider>
        <AiHealthFixButton />
      </AiHealthProvider>
    </ServerConfigContext.Provider>,
  );

  await expect.poll(() => calls.length).toBeGreaterThan(0);
});
