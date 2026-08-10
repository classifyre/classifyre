import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";
import { AiHealthProvider, AiHealthFixButton } from "@/components/ai-health";
import { ServerConfigContext } from "@/components/server-config-provider";
import { useInstanceSettings } from "@/components/instance-settings-provider";

function ConfigureHarnessOnly() {
  const { updateSettings } = useInstanceSettings();
  return (
    <button
      onClick={() =>
        void updateSettings({
          aiEnabled: false,
          aiProviderConfigId: null,
          harnessEnabled: true,
          harnessAiProviderConfigId: "harness-provider",
        })
      }
    >
      Configure Harness only
    </button>
  );
}

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

test("outside demo mode missing role assignments link to Harness configuration", async ({
  mount,
  page,
}) => {
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

  expect(calls).toEqual([]);
  await expect(page.getByRole("link")).toHaveAttribute(
    "href",
    "/harness?tab=config",
  );
});

test("global warning ignores Assistant state once Harness is healthy", async ({
  mount,
  page,
}) => {
  let harnessTests = 0;
  await page.route("**/instance-settings", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 1,
        aiEnabled: false,
        harnessEnabled: true,
        mcpEnabled: true,
        language: "ENGLISH",
        timezone: "UTC",
        timeFormat: "TWELVE_HOUR",
        aiProviderConfigId: null,
        harnessAiProviderConfigId: "harness-provider",
        demoMode: false,
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

  const component = await mount(
    <ServerConfigContext.Provider
      value={{ s3Configured: false, demoMode: false }}
    >
      <AiHealthProvider>
        <ConfigureHarnessOnly />
        <AiHealthFixButton />
      </AiHealthProvider>
    </ServerConfigContext.Provider>,
  );

  await component
    .getByRole("button", { name: "Configure Harness only" })
    .click();
  await expect.poll(() => harnessTests).toBe(1);
  await expect(component.getByRole("link")).toHaveCount(0);
});
