import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";
import { AiHealthProvider, AiHealthHarnessStatus } from "@/components/ai-health";
import { ServerConfigContext } from "@/components/server-config-provider";
import { AiHealthHarness } from "@/tests/components/fixtures/ai-health-harness";
import { signedInAs } from "@/tests/components/fixtures/signed-in";

type CtPage = Parameters<Parameters<typeof test>[2]>[0]["page"];

/**
 * Records every call to the AI provider endpoints. Someone who may not
 * configure AI providers (a viewer, a visitor of a public workspace) never
 * triggers the health probe: they cannot fix a provider, and the probe
 * itself is a POST that needs agent.configure.
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

test("without agent.configure no provider probe is issued and no harness status rendered", async ({
  mount,
  page,
}) => {
  const { calls } = await trackProviderCalls(page);
  await signedInAs(page, ["workspace.view"]);

  await mount(
    <ServerConfigContext.Provider
      value={{ logsPersisted: false }}
    >
      <AiHealthProvider>
        <AiHealthHarnessStatus />
      </AiHealthProvider>
    </ServerConfigContext.Provider>,
  );

  // Long enough that the effect would have fired had it been going to.
  await page.waitForTimeout(700);

  expect(calls).toEqual([]);
  await expect(page.getByTestId("ai-health-harness-status")).toHaveCount(0);
});

test("with agent.configure a missing provider marks the Harness entry", async ({
  mount,
  page,
}) => {
  const { calls } = await trackProviderCalls(page);
  await signedInAs(page, ["workspace.view", "agent.configure"]);

  await mount(
    <ServerConfigContext.Provider
      value={{ logsPersisted: false }}
    >
      <AiHealthProvider>
        <AiHealthHarnessStatus />
      </AiHealthProvider>
    </ServerConfigContext.Provider>,
  );

  expect(calls).toEqual([]);
  await expect(page.getByTestId("ai-health-harness-status")).toHaveAttribute(
    "data-status",
    "not_configured",
  );
});

test("global warning ignores Assistant state once Harness is healthy", async ({
  mount,
  page,
}) => {
  await signedInAs(page, ["workspace.view", "agent.configure"]);
  let harnessTests = 0;
  await page.route("**/instance-settings", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 1,
        mcpEnabled: true,
        language: "ENGLISH",
        timezone: "UTC",
        timeFormat: "TWELVE_HOUR",
        aiProviderConfigId: null,
        harnessAiProviderConfigId: "harness-provider",
        createdAt: "2026-08-10T00:00:00.000Z",
        updatedAt: "2026-08-10T00:00:00.000Z",
      }),
    });
  });
  await page.route("**/ai-provider-configs**", async (route) => {
    const isTest = route.request().url().endsWith("/harness-provider/test");
    if (isTest) harnessTests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        isTest
          ? {
              status: "PASS",
              category: "CONNECTION",
              provider: "CLAUDE",
              model: "claude-sonnet-4-5",
              message: "Harness provider connected successfully.",
              details: ["The provider returned a response."],
              durationMs: 50,
              inputTokens: 10,
              outputTokens: 5,
              responsePreview: "ok",
            }
          : [
              {
                id: "harness-provider",
                name: "Harness Claude",
                provider: "CLAUDE",
                model: "claude-sonnet-4-5",
              },
            ],
      ),
    });
  });

  const component = await mount(<AiHealthHarness />);

  await component
    .getByRole("button", { name: "Configure Harness only" })
    .click();
  await expect.poll(() => harnessTests).toBe(1);
  await expect(page.getByTestId("ai-health-harness-status")).toHaveCount(0);
});
