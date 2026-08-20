import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";
import { CellListHarness } from "./fixtures/cell-list-harness";
import type { NotebookCell } from "@/lib/notebook-cells";

const cells = (): NotebookCell[] => [
  { id: "imports", type: "code", source: "from classifyre import Asset, ctx" },
  { id: "extract", type: "code", source: "def extract():\n    pass" },
];

const aiConfig = {
  packages: [{ name: "httpx", version: ">=0.27" }],
  variables: { api_base: "https://api.example.com" },
  secretKeys: ["api_token"],
};

const json = (body: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify(body),
});

/**
 * Make the real AI health provider report a configured, working provider.
 *
 * The harness mounts the actual provider rather than a stub, so "is AI
 * available" is exercised the way it runs — which means standing up the three
 * responses it reads.
 */
async function stubAiConfigured(page: any, { healthy = true } = {}) {
  await page.route("**/instance-settings**", (route: any) =>
    route.fulfill(json({ harnessAiProviderConfigId: healthy ? "p1" : null })),
  );
  await page.route("**/ai-provider-configs/p1", (route: any) =>
    route.fulfill(json({ id: "p1", name: "Test" })),
  );
  await page.route("**/ai-provider-configs", (route: any) =>
    route.fulfill(json(healthy ? [{ id: "p1", name: "Test" }] : [])),
  );
  await page.route("**/ai-provider-configs/*/test", (route: any) =>
    route.fulfill(json({ status: "PASS", message: "ok" })),
  );
}

/** Answer the one provider call the assistant makes, and capture what it sent. */
async function stubProvider(page: any, content: string) {
  const sent: any[] = [];
  await stubAiConfigured(page);
  await page.route("**/ai/complete", async (route: any) => {
    sent.push(JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill(json({ content, model: "test", provider: "test" }));
  });
  return sent;
}

async function enableAi(component: any) {
  // The settings fetch does not resolve under component tests, so the harness
  // sets the provider id the way the settings UI does.
  await component.getByTestId("configure-ai").click();
  await expect(component.getByTestId("cell-ai-open-extract")).toBeVisible({
    timeout: 10_000,
  });
}

async function ask(component: any, question: string) {
  await enableAi(component);
  await component.getByTestId("cell-ai-open-extract").click();
  await component.getByTestId("cell-ai-input-extract").fill(question);
  await component.getByTestId("cell-ai-send-extract").click();
}

test("a code reply rewrites the cell", async ({ mount, page }) => {
  await stubProvider(
    page,
    "Done.\n\n```python\ndef extract():\n    yield Asset(id='1')\n```",
  );
  const component = await mount(
    <CellListHarness initialCells={cells()} ai={aiConfig} />,
  );

  await ask(component, "make extract yield one asset");

  await expect(component.getByTestId("cell-sources")).toContainText(
    "extract:def extract():\n    yield Asset(id='1')",
  );
});

test("a prose reply leaves the cell alone", async ({ mount, page }) => {
  // Asking a question must never silently rewrite the code.
  await stubProvider(page, "It fails because the token has expired.");
  const component = await mount(
    <CellListHarness initialCells={cells()} ai={aiConfig} />,
  );

  await ask(component, "why does this fail?");

  await expect(component.getByTestId("cell-ai-history")).toContainText(
    "token has expired",
  );
  await expect(component.getByTestId("cell-sources")).toContainText(
    "extract:def extract():\n    pass",
  );
});

test("an applied change can be undone", async ({ mount, page }) => {
  await stubProvider(page, "```python\ndef extract():\n    yield 1\n```");
  const component = await mount(
    <CellListHarness initialCells={cells()} ai={aiConfig} />,
  );

  await ask(component, "rewrite it");
  await expect(component.getByTestId("cell-sources")).toContainText("yield 1");

  await component.getByTestId("cell-ai-undo").click();
  await expect(component.getByTestId("cell-sources")).toContainText(
    "extract:def extract():\n    pass",
  );
});

test("the model is sent the notebook, packages, variables and secret names", async ({
  mount,
  page,
}) => {
  const sent = await stubProvider(page, "ok");
  const component = await mount(
    <CellListHarness initialCells={cells()} ai={aiConfig} />,
  );

  await ask(component, "what can you see?");
  await expect(component.getByTestId("cell-ai-history")).toContainText("ok");

  const system = sent[0].messages[0].content as string;
  expect(system).toContain("cell id=imports");
  expect(system).toContain("THE TARGET CELL");
  expect(system).toContain("httpx >=0.27");
  expect(system).toContain('ctx.var("api_base")');
  expect(system).toContain('ctx.secret("api_token")');
});

test("it makes exactly one request, to the AI provider", async ({
  mount,
  page,
}) => {
  // No MCP, no tool loop, no other API call — the whole feature is one
  // completion, and a regression here would be invisible in the UI.
  await stubAiConfigured(page);

  const afterOpen: string[] = [];
  let watching = false;
  await page.route("**/ai/complete", async (route: any) => {
    if (watching) afterOpen.push("/ai/complete");
    await route.fulfill(json({ content: "ok", model: "m", provider: "p" }));
  });
  // Anything that would be an MCP call, a tool round-trip, or a notebook save.
  await page.route(
    /\/(notebook|mcp|assistant|sources)\b/,
    async (route: any) => {
      if (watching) afterOpen.push(new URL(route.request().url()).pathname);
      await route.fulfill(json({}));
    },
  );

  const component = await mount(
    <CellListHarness initialCells={cells()} ai={aiConfig} />,
  );
  await enableAi(component);

  watching = true;
  await ask(component, "hello");
  await expect(component.getByTestId("cell-ai-history")).toContainText("ok");

  expect(afterOpen).toEqual(["/ai/complete"]);
});

test("history is kept across turns", async ({ mount, page }) => {
  const sent = await stubProvider(page, "second answer");
  const component = await mount(
    <CellListHarness initialCells={cells()} ai={aiConfig} />,
  );

  await ask(component, "first question");
  await expect(component.getByTestId("cell-ai-history")).toContainText(
    "second answer",
  );

  await component.getByTestId("cell-ai-input-extract").fill("second question");
  await component.getByTestId("cell-ai-send-extract").click();
  await expect(component.getByTestId("cell-ai-history")).toContainText(
    "second question",
  );

  // The second call carries the first exchange, so the model can follow on.
  const roles = sent[1].messages.map((m: any) => m.role);
  expect(roles).toEqual(["system", "user", "assistant", "user"]);
  expect(sent[1].messages[1].content).toBe("first question");
});

test("the control links to configuration when AI is not set up", async ({
  mount,
  page,
}) => {
  // Disabled rather than hidden: an absent control teaches nobody that the
  // feature exists or what it needs.
  await stubAiConfigured(page, { healthy: false });
  const component = await mount(
    <CellListHarness initialCells={cells()} ai={aiConfig} />,
  );

  await expect(component.getByTestId("cell-ai-open-extract")).toHaveCount(0);
  const fallback = component.getByTestId("cell-ai-unavailable-extract");
  await expect(fallback).toBeVisible();
  await expect(fallback).toHaveAttribute("href", /harness\?tab=config/);
  await expect(fallback).toHaveAttribute("aria-label", /not configured/i);
});
