import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";
import { AiAssistantSettingsCard } from "@/components/ai-assistant-settings-card";

type CtPage = Parameters<Parameters<typeof test>[2]>[0]["page"];

type SettingsState = {
  aiEnabled: boolean;
  aiProviderConfigId: string | null;
};

const PROVIDERS = [
  {
    id: "cfg-1",
    name: "Prod Claude",
    provider: "CLAUDE",
    model: "claude-sonnet-4-5",
    hasApiKey: true,
    apiKeyPreview: "sk-c...9999",
    baseUrl: null,
    contextSize: 200000,
    createdAt: "2026-03-10T00:00:00.000Z",
    updatedAt: "2026-03-10T00:00:00.000Z",
  },
  {
    id: "cfg-2",
    name: "Dev OpenRouter",
    provider: "OPENAI_COMPATIBLE",
    model: "openrouter/auto",
    hasApiKey: true,
    apiKeyPreview: "sk-o...1234",
    baseUrl: "https://openrouter.ai/api/v1",
    contextSize: null,
    createdAt: "2026-03-10T00:00:00.000Z",
    updatedAt: "2026-03-10T00:00:00.000Z",
  },
];

async function mockApi(page: CtPage, initial: SettingsState) {
  const state: SettingsState = { ...initial };
  const putPayloads: Array<Record<string, unknown>> = [];

  function settingsBody() {
    return {
      id: 1,
      aiEnabled: state.aiEnabled,
      mcpEnabled: true,
      language: "ENGLISH",
      timezone: "UTC",
      timeFormat: "TWELVE_HOUR",
      aiProviderConfigId: state.aiProviderConfigId,
      demoMode: false,
      createdAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
    };
  }

  await page.route("**/instance-settings", async (route) => {
    if (route.request().method() === "PUT") {
      const payload = (route.request().postDataJSON() ?? {}) as Record<
        string,
        unknown
      >;
      putPayloads.push(payload);
      if ("aiEnabled" in payload) {
        state.aiEnabled = Boolean(payload.aiEnabled);
      }
      if ("aiProviderConfigId" in payload) {
        state.aiProviderConfigId =
          (payload.aiProviderConfigId as string | null) ?? null;
      }
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(settingsBody()),
    });
  });

  await page.route("**/ai-provider-configs", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(PROVIDERS),
    });
  });

  return {
    getPutPayloads: () => putPayloads,
    getState: () => state,
  };
}

test("selecting an assistant model persists the provider id", async ({
  mount,
  page,
}) => {
  const mock = await mockApi(page, {
    aiEnabled: true,
    aiProviderConfigId: null,
  });

  const component = await mount(<AiAssistantSettingsCard />);

  await component.getByRole("combobox").click();
  await page.getByRole("option", { name: "Dev OpenRouter" }).click();

  await expect
    .poll(() => mock.getState().aiProviderConfigId)
    .toBe("cfg-2");
  await expect(component.getByText("openrouter/auto")).toBeVisible();
});

test("toggling the assistant off persists aiEnabled=false", async ({
  mount,
  page,
}) => {
  const mock = await mockApi(page, {
    aiEnabled: true,
    aiProviderConfigId: "cfg-1",
  });

  const component = await mount(<AiAssistantSettingsCard />);

  await component.getByRole("switch").click();

  await expect.poll(() => mock.getState().aiEnabled).toBe(false);
  expect(
    mock.getPutPayloads().some((p) => p.aiEnabled === false),
  ).toBe(true);
});
