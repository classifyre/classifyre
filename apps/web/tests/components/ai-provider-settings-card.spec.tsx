import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";
import { AiProviderSettingsCard } from "@/components/ai-provider-settings-card";

type MockConfig = {
  provider: "OPENAI_COMPATIBLE" | "CLAUDE" | "GEMINI";
  model: string;
  hasApiKey: boolean;
  apiKeyPreview: string | null;
  baseUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

async function mockAiProviderSettings(
  page: import("@playwright/test").Page,
  initialConfig: MockConfig,
) {
  let storedConfig = { ...initialConfig };
  const updatePayloads: Array<Record<string, unknown>> = [];
  let completeCalls = 0;

  await page.route("**/instance-settings/ai-provider", async (route) => {
    const method = route.request().method();

    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(storedConfig),
      });
      return;
    }

    if (method === "PUT") {
      const payload = (route.request().postDataJSON() ?? {}) as Record<
        string,
        unknown
      >;
      updatePayloads.push(payload);

      storedConfig = {
        ...storedConfig,
        provider:
          (payload.provider as MockConfig["provider"]) ?? storedConfig.provider,
        model:
          typeof payload.model === "string"
            ? payload.model
            : storedConfig.model,
        baseUrl:
          "baseUrl" in payload
            ? typeof payload.baseUrl === "string"
              ? payload.baseUrl
              : null
            : storedConfig.baseUrl,
        hasApiKey:
          typeof payload.apiKey === "string"
            ? payload.apiKey.length > 0
            : storedConfig.hasApiKey,
        apiKeyPreview:
          typeof payload.apiKey === "string"
            ? payload.apiKey.length > 0
              ? "sk-t...1234"
              : null
            : storedConfig.apiKeyPreview,
        updatedAt: "2026-03-10T12:00:00.000Z",
      };

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(storedConfig),
      });
      return;
    }

    await route.continue();
  });

  await page.route("**/ai/complete", async (route) => {
    completeCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        content: '{"status":"ok","square":49,"language":"TypeScript"}',
        model: storedConfig.model,
        provider: storedConfig.provider,
      }),
    });
  });

  return {
    getStoredConfig: () => storedConfig,
    getUpdatePayloads: () => updatePayloads,
    getCompleteCalls: () => completeCalls,
  };
}

test("save persists the current provider draft instead of resetting to the previous provider", async ({
  mount,
  page,
}) => {
  const mock = await mockAiProviderSettings(page, {
    provider: "CLAUDE",
    model: "claude-sonnet-4-5",
    hasApiKey: true,
    apiKeyPreview: "sk-c...9999",
    baseUrl: null,
    createdAt: "2026-03-10T00:00:00.000Z",
    updatedAt: "2026-03-10T00:00:00.000Z",
  });

  const component = await mount(<AiProviderSettingsCard />);

  await component.getByRole("combobox").click();
  await page.getByRole("option", { name: "OpenAI-Compatible" }).click();

  await component.getByPlaceholder("gpt-4o").fill("openrouter/auto");
  await component
    .getByPlaceholder("https://openrouter.ai/api/v1")
    .fill("https://openrouter.ai/api/v1");

  await component.getByRole("button", { name: "Save" }).click();

  await expect.poll(() => mock.getUpdatePayloads().length).toBe(1);
  await expect(mock.getUpdatePayloads()[0]).toEqual({
    provider: "OPENAI_COMPATIBLE",
    model: "openrouter/auto",
    baseUrl: "https://openrouter.ai/api/v1",
  });
  await expect(mock.getStoredConfig()).toMatchObject({
    provider: "OPENAI_COMPATIBLE",
    model: "openrouter/auto",
    baseUrl: "https://openrouter.ai/api/v1",
  });
});

test("test connection saves the latest draft before calling ai/complete", async ({
  mount,
  page,
}) => {
  const mock = await mockAiProviderSettings(page, {
    provider: "CLAUDE",
    model: "claude-sonnet-4-5",
    hasApiKey: true,
    apiKeyPreview: "sk-c...9999",
    baseUrl: null,
    createdAt: "2026-03-10T00:00:00.000Z",
    updatedAt: "2026-03-10T00:00:00.000Z",
  });

  const component = await mount(<AiProviderSettingsCard />);

  await component.getByRole("combobox").click();
  await page.getByRole("option", { name: "Gemini (Google)" }).click();
  await component.getByPlaceholder("gemini-2.0-flash").fill("gemini-2.5-pro");

  await component.getByRole("button", { name: "Test connection" }).click();

  await expect.poll(() => mock.getUpdatePayloads().length).toBe(1);
  await expect.poll(() => mock.getCompleteCalls()).toBe(1);
  await expect(mock.getUpdatePayloads()[0]).toEqual({
    provider: "GEMINI",
    model: "gemini-2.5-pro",
    baseUrl: "",
  });
  await expect(
    component.getByText("Connection OK · GEMINI · gemini-2.5-pro"),
  ).toBeVisible();
});
