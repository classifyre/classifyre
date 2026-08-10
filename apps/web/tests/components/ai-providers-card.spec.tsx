import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";
import { AiProvidersCard } from "@/components/ai-providers-card";
import { AiProviderForm } from "@/components/ai-provider-form";
import type { AiProviderConfigResponseDto } from "@workspace/api-client";

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

function baseSettings(
  aiProviderConfigId: string | null,
  harnessAiProviderConfigId: string | null,
  aiEnabled = true,
  harnessEnabled = true,
) {
  return {
    id: 1,
    aiEnabled,
    harnessEnabled,
    mcpEnabled: true,
    language: "ENGLISH",
    timezone: "UTC",
    timeFormat: "TWELVE_HOUR",
    aiProviderConfigId,
    harnessAiProviderConfigId,
    demoMode: false,
    createdAt: "2026-03-10T00:00:00.000Z",
    updatedAt: "2026-03-10T00:00:00.000Z",
  };
}

async function mockApi(page: CtPage, initial: StoredProvider[]) {
  const providers = [...initial];
  let assistantId: string | null = null;
  let harnessId: string | null = null;
  let assistantEnabled = true;
  let harnessEnabled = true;
  const createPayloads: Array<Record<string, unknown>> = [];
  let testCalls = 0;
  let capabilityTestCalls = 0;

  await page.route("**/instance-settings", async (route) => {
    if (route.request().method() === "PUT") {
      const payload = (route.request().postDataJSON() ?? {}) as {
        aiEnabled?: boolean;
        harnessEnabled?: boolean;
        aiProviderConfigId?: string | null;
        harnessAiProviderConfigId?: string | null;
      };
      if ("aiProviderConfigId" in payload) {
        assistantId = payload.aiProviderConfigId ?? null;
      }
      if ("harnessAiProviderConfigId" in payload) {
        harnessId = payload.harnessAiProviderConfigId ?? null;
      }
      if ("aiEnabled" in payload) {
        assistantEnabled = payload.aiEnabled ?? true;
      }
      if ("harnessEnabled" in payload) {
        harnessEnabled = payload.harnessEnabled ?? true;
      }
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        baseSettings(assistantId, harnessId, assistantEnabled, harnessEnabled),
      ),
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
        provider: (payload.provider as StoredProvider["provider"]) ?? "CLAUDE",
        model: typeof payload.model === "string" ? payload.model : "",
        hasApiKey:
          typeof payload.apiKey === "string" && payload.apiKey.length > 0,
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
      await route.fulfill({
        status: 204,
        contentType: "application/json",
        body: "",
      });
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
          : (existing?.name ?? ""),
      provider:
        (payload.provider as StoredProvider["provider"]) ??
        existing?.provider ??
        "CLAUDE",
      model:
        typeof payload.model === "string"
          ? payload.model
          : (existing?.model ?? ""),
      hasApiKey:
        typeof payload.apiKey === "string"
          ? payload.apiKey.length > 0
          : (existing?.hasApiKey ?? false),
      apiKeyPreview: existing?.apiKeyPreview ?? null,
      baseUrl:
        typeof payload.baseUrl === "string"
          ? payload.baseUrl || null
          : (existing?.baseUrl ?? null),
      contextSize:
        typeof payload.contextSize === "number"
          ? payload.contextSize
          : (existing?.contextSize ?? null),
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

  await page.route("**/custom-detectors", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
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
        status: "PASS",
        category: "CONNECTION",
        provider: found?.provider ?? "CLAUDE",
        model: found?.model ?? "",
        message: "Prod Claude connected successfully and returned a response.",
        details: [
          "The provider accepted a real completion request.",
          "The configured model returned content before the timeout.",
        ],
        durationMs: 84,
        inputTokens: 12,
        outputTokens: 7,
        responsePreview: '{"status":"ok"}',
      }),
    });
  });

  await page.route(
    "**/ai-provider-configs/*/capability-test-stream",
    async (route) => {
      capabilityTestCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body:
          [
            JSON.stringify({
              type: "started",
              configId: "cfg-1",
              configName: "Prod Claude",
              provider: "CLAUDE",
              model: "claude-sonnet-4-5",
              totalProbes: 1,
            }),
            JSON.stringify({
              type: "probe_started",
              index: 1,
              totalProbes: 1,
              probe: {
                id: "json.strict",
                tier: "PROTOCOL",
                title: "Strict JSON",
                whatItProves: "Returns machine-readable turns",
              },
            }),
            JSON.stringify({
              type: "probe_completed",
              index: 1,
              totalProbes: 1,
              probe: {
                id: "json.strict",
                tier: "PROTOCOL",
                title: "Strict JSON",
                whatItProves: "Returns machine-readable turns",
                status: "PASS",
                reason: "Valid Harness turn returned.",
                prompt: null,
                rawOutput: null,
                latencyMs: 42,
                inputTokens: 10,
                outputTokens: 5,
              },
            }),
            JSON.stringify({ type: "capacity_started" }),
            JSON.stringify({ type: "capacity_completed", agents: [] }),
            JSON.stringify({
              type: "complete",
              report: {
                configId: "cfg-1",
                configName: "Prod Claude",
                provider: "CLAUDE",
                model: "claude-sonnet-4-5",
                verdict: "READY",
                headline: "Ready for all Harness agents",
                abortedEarly: false,
                probes: [],
                agents: [],
                cost: {
                  avgInputTokensPerTurn: null,
                  avgOutputTokensPerTurn: null,
                  estimatedCostPerRunUsd: null,
                  basedOnAgent: null,
                },
                totalInputTokens: 10,
                totalOutputTokens: 5,
                totalDurationMs: 100,
                ranAt: "2026-08-10T00:00:00.000Z",
                assumptions: [],
              },
            }),
          ].join("\n") + "\n",
      });
    },
  );

  return {
    getCreatePayloads: () => createPayloads,
    getAssistantId: () => assistantId,
    getHarnessId: () => harnessId,
    getAssistantEnabled: () => assistantEnabled,
    getHarnessEnabled: () => harnessEnabled,
    getTestCalls: () => testCalls,
    getCapabilityTestCalls: () => capabilityTestCalls,
  };
}

test("provider creation uses a dedicated Harness page", async ({
  mount,
  page,
}) => {
  await mockApi(page, []);
  const component = await mount(<AiProvidersCard />);
  await expect(component.getByText("No AI providers yet.")).toBeVisible();
  await expect(
    component.getByRole("link", { name: "Add provider" }),
  ).toHaveAttribute("href", "/harness/providers/new");
});

test("provider editing uses its dedicated page", async ({ mount, page }) => {
  await mockApi(page, [
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
  await expect(component.getByTitle("Edit")).toHaveAttribute(
    "href",
    "/harness/providers/cfg-1/edit",
  );
});

test("Assistant and Harness can be enabled and assigned independently", async ({
  mount,
  page,
}) => {
  const mock = await mockApi(page, [
    {
      id: "cfg-1",
      name: "Shared Claude",
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

  await component
    .getByRole("switch", { name: "AI Assistant", exact: true })
    .click();
  await expect.poll(() => mock.getAssistantEnabled()).toBe(false);
  expect(mock.getHarnessEnabled()).toBe(true);

  await component
    .getByRole("switch", { name: "Use for AI Assistant — Shared Claude" })
    .click();
  await component
    .getByRole("switch", { name: "Use for AI Harness — Shared Claude" })
    .click();

  await expect.poll(() => mock.getAssistantId()).toBe("cfg-1");
  await expect.poll(() => mock.getHarnessId()).toBe("cfg-1");
});

test("connection diagnostics explain a successful provider test", async ({
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

  const provider = {
    id: "cfg-1",
    name: "Prod Claude",
    provider: "CLAUDE",
    model: "claude-sonnet-4-5",
    hasApiKey: true,
    apiKeyPreview: "sk-c...9999",
    baseUrl: null,
    contextSize: 200000,
    supportsVision: false,
    inputCostPerMTok: null,
    outputCostPerMTok: null,
    createdAt: new Date("2026-03-10T00:00:00.000Z"),
    updatedAt: new Date("2026-03-10T00:00:00.000Z"),
  } as AiProviderConfigResponseDto;
  await mount(
    <AiProviderForm
      config={provider}
      onSaved={() => undefined}
      onCancel={() => undefined}
    />,
  );
  await page.getByRole("button", { name: "Test connection" }).click();

  await expect.poll(() => mock.getTestCalls()).toBe(1);
  await expect(
    page.getByText(
      "Prod Claude connected successfully and returned a response.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("The provider accepted a real completion request."),
  ).toBeVisible();
  await expect(page.getByText('{"status":"ok"}')).toBeVisible();
});

test("Harness capability streams stages and renders the final report", async ({
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
  const provider = {
    id: "cfg-1",
    name: "Prod Claude",
    provider: "CLAUDE",
    model: "claude-sonnet-4-5",
    hasApiKey: true,
    apiKeyPreview: "sk-c...9999",
    baseUrl: null,
    contextSize: 200000,
    supportsVision: false,
    inputCostPerMTok: null,
    outputCostPerMTok: null,
    createdAt: new Date("2026-03-10T00:00:00.000Z"),
    updatedAt: new Date("2026-03-10T00:00:00.000Z"),
  } as AiProviderConfigResponseDto;
  await mount(
    <AiProviderForm
      config={provider}
      onSaved={() => undefined}
      onCancel={() => undefined}
    />,
  );
  await page.getByRole("combobox", { name: "Test type" }).click();
  await page.getByRole("option", { name: "Harness capability" }).click();
  await page.getByRole("button", { name: "Test Harness" }).click();

  await expect.poll(() => mock.getCapabilityTestCalls()).toBe(1);
  expect(mock.getTestCalls()).toBe(0);
  await expect(page.getByTestId("capability-report")).toBeVisible();
});
