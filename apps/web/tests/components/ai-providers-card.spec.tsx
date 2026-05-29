import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";
import { AiProvidersCard } from "@/components/ai-providers-card";

// Derive the page fixture type from the component-test `test` so this helper
// stays in sync with the playwright-core version the fixtures use.
type CtPage = Parameters<Parameters<typeof test>[2]>[0]["page"];

type StoredProvider = {
  id: string;
  name: string;
  provider: "OPENAI_COMPATIBLE" | "CLAUDE" | "GEMINI";
  model: string;
  hasApiKey: boolean;
  apiKeyPreview: string | null;
  baseUrl: string | null;
  contextSize: number | null;
  createdAt: string;
  updatedAt: string;
};

function baseSettings(aiProviderConfigId: string | null) {
  return {
    id: 1,
    aiEnabled: true,
    mcpEnabled: true,
    language: "ENGLISH",
    timezone: "UTC",
    timeFormat: "TWELVE_HOUR",
    aiProviderConfigId,
    demoMode: false,
    createdAt: "2026-03-10T00:00:00.000Z",
    updatedAt: "2026-03-10T00:00:00.000Z",
  };
}

async function mockApi(page: CtPage, initial: StoredProvider[]) {
  const providers = [...initial];
  let defaultId: string | null = null;
  const createPayloads: Array<Record<string, unknown>> = [];
  let testCalls = 0;

  await page.route("**/instance-settings", async (route) => {
    if (route.request().method() === "PUT") {
      const payload = (route.request().postDataJSON() ?? {}) as {
        aiProviderConfigId?: string | null;
      };
      if ("aiProviderConfigId" in payload) {
        defaultId = payload.aiProviderConfigId ?? null;
      }
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(baseSettings(defaultId)),
    });
  });

  await page.route("**/ai-provider-configs", async (route) => {
    const method = route.request().method();
    if (method === "POST") {
      const payload = (route.request().postDataJSON() ?? {}) as Record<
        string,
        unknown
      >;
      createPayloads.push(payload);
      const created: StoredProvider = {
        id: `cfg-${providers.length + 1}`,
        name: String(payload.name ?? ""),
        provider:
          (payload.provider as StoredProvider["provider"]) ?? "CLAUDE",
        model: typeof payload.model === "string" ? payload.model : "",
        hasApiKey: typeof payload.apiKey === "string" && payload.apiKey.length > 0,
        apiKeyPreview:
          typeof payload.apiKey === "string" && payload.apiKey.length > 0
            ? "sk-t...1234"
            : null,
        baseUrl: typeof payload.baseUrl === "string" ? payload.baseUrl : null,
        contextSize:
          typeof payload.contextSize === "number" ? payload.contextSize : null,
        createdAt: "2026-03-10T00:00:00.000Z",
        updatedAt: "2026-03-10T00:00:00.000Z",
      };
      providers.push(created);
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(created),
      });
      return;
    }
    // GET list
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(providers),
    });
  });

  await page.route("**/ai-provider-configs/*", async (route) => {
    const id = route.request().url().split("/").pop() ?? "";
    const idx = providers.findIndex((p) => p.id === id);
    if (route.request().method() === "DELETE") {
      if (idx >= 0) providers.splice(idx, 1);
      await route.fulfill({ status: 204, contentType: "application/json", body: "" });
      return;
    }
    // PUT update
    const payload = (route.request().postDataJSON() ?? {}) as Record<
      string,
      unknown
    >;
    const existing = providers[idx];
    const updated: StoredProvider = {
      id,
      name:
        typeof payload.name === "string"
          ? payload.name
          : existing?.name ?? "",
      provider:
        (payload.provider as StoredProvider["provider"]) ??
        existing?.provider ??
        "CLAUDE",
      model:
        typeof payload.model === "string"
          ? payload.model
          : existing?.model ?? "",
      hasApiKey:
        typeof payload.apiKey === "string"
          ? payload.apiKey.length > 0
          : existing?.hasApiKey ?? false,
      apiKeyPreview: existing?.apiKeyPreview ?? null,
      baseUrl:
        typeof payload.baseUrl === "string"
          ? payload.baseUrl || null
          : existing?.baseUrl ?? null,
      contextSize:
        typeof payload.contextSize === "number"
          ? payload.contextSize
          : existing?.contextSize ?? null,
      createdAt: existing?.createdAt ?? "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T12:00:00.000Z",
    };
    if (idx >= 0) providers[idx] = updated;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(updated),
    });
  });

  await page.route("**/ai-provider-configs/*/test", async (route) => {
    testCalls += 1;
    const id = route.request().url().split("/").slice(-2, -1)[0];
    const found = providers.find((p) => p.id === id) ?? providers[0];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        provider: found?.provider ?? "CLAUDE",
        model: found?.model ?? "",
      }),
    });
  });

  return {
    getCreatePayloads: () => createPayloads,
    getDefaultId: () => defaultId,
    getTestCalls: () => testCalls,
  };
}

test("creating a provider posts it and sets it as the default", async ({
  mount,
  page,
}) => {
  const mock = await mockApi(page, []);

  const component = await mount(<AiProvidersCard />);

  await expect(component.getByText("No AI providers yet.")).toBeVisible();

  await component.getByRole("button", { name: "Add provider" }).click();

  await page.getByPlaceholder("e.g. Production Claude").fill("Prod Claude");
  await page.getByPlaceholder("Enter API key…").fill("sk-test-12345678");
  await page.getByRole("button", { name: "Create" }).click();

  await expect.poll(() => mock.getCreatePayloads().length).toBe(1);
  expect(mock.getCreatePayloads()[0]).toMatchObject({
    name: "Prod Claude",
    provider: "CLAUDE",
    apiKey: "sk-test-12345678",
  });
  await expect.poll(() => mock.getDefaultId()).toBe("cfg-1");
  await expect(
    component.getByRole("listitem").filter({ hasText: "Prod Claude" }),
  ).toBeVisible();
});

test("test connection persists the draft then calls the test endpoint", async ({
  mount,
  page,
}) => {
  const mock = await mockApi(page, [
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
  ]);

  const component = await mount(<AiProvidersCard />);

  await component.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("button", { name: "Test connection" }).click();

  await expect.poll(() => mock.getTestCalls()).toBe(1);
  await expect(
    page.getByText("Connection OK · CLAUDE · claude-sonnet-4-5"),
  ).toBeVisible();
});
