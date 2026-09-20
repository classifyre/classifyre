import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";
import { FeatureSwitchesHarness } from "./fixtures/feature-switches-harness";

type CtPage = Parameters<Parameters<typeof test>[2]>[0]["page"];

const settings = {
  id: 1,
  mcpEnabled: true,
  language: "ENGLISH",
  timezone: "UTC",
  timeFormat: "TWELVE_HOUR",
  aiProviderConfigId: null,
  harnessAiProviderConfigId: null,
  demoMode: false,
  createdAt: "2026-03-10T00:00:00.000Z",
  updatedAt: "2026-03-10T00:00:00.000Z",
};

type FeatureFixture = {
  key: "embeddings" | "duplicates";
  enabled: boolean;
  disabledMode: string | null;
  changedAt: string | null;
  deploymentDefault: boolean | null;
  dataset: string;
  dataRows: number;
  dataBytes: number;
  tables: string[];
  heldQueues: string[];
  cleanupRunId: string | null;
};

function feature(
  key: "embeddings" | "duplicates",
  over: Partial<FeatureFixture> = {},
): FeatureFixture {
  return {
    key,
    enabled: true,
    disabledMode: null,
    changedAt: null,
    deploymentDefault: key === "embeddings" ? true : null,
    dataset: key,
    dataRows: 23_500_000,
    dataBytes: 17 * 1024 ** 3,
    tables: [],
    heldQueues: [],
    cleanupRunId: null,
    ...over,
  };
}

/**
 * Serves the switches from mutable state so a PUT is reflected by the next
 * GET, like the API. Returns the bodies of every PUT.
 */
async function mockFeaturesApi(
  page: CtPage,
  initial: {
    embeddings?: Partial<FeatureFixture>;
    duplicates?: Partial<FeatureFixture>;
  } = {},
) {
  const state = {
    embeddings: feature("embeddings", initial.embeddings),
    duplicates: feature("duplicates", initial.duplicates),
  };
  const puts: Array<{ url: string; body: Record<string, unknown> }> = [];
  await page.route("**/instance-settings", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(settings),
    }),
  );
  await page.route("**/namespaces**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.route("**/maintenance/features/*", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const url = route.request().url();
    puts.push({ url, body });
    const key = url.endsWith("/embeddings") ? "embeddings" : "duplicates";
    state[key] = {
      ...state[key],
      enabled: body.enabled === true,
      disabledMode:
        body.enabled === true ? null : body.deleteData ? "deleted" : "kept",
      heldQueues:
        body.enabled === true
          ? []
          : key === "duplicates"
            ? ["correlation.scan"]
            : ["semantic-embeddings-s1"],
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        feature: state[key],
        cleanupRunId: null,
        recomputeScheduled: body.enabled === true && key === "duplicates",
        note: "",
      }),
    });
  });
  await page.route("**/maintenance/features", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        features: [state.embeddings, state.duplicates],
      }),
    }),
  );
  return { puts };
}

test("lists both switches with their state and what they cost", async ({
  mount,
  page,
}) => {
  await mockFeaturesApi(page, {
    duplicates: {
      enabled: false,
      disabledMode: "kept",
      heldQueues: ["correlation.scan"],
    },
  });
  const component = await mount(<FeatureSwitchesHarness />);

  const duplicates = component.getByTestId("feature-row-duplicates");
  await expect(duplicates.getByText("Duplicate detection")).toBeVisible();
  await expect(duplicates.getByText("Off · data kept")).toBeVisible();
  await expect(duplicates.getByText(/17\.0 GB of data/)).toBeVisible();
  await expect(
    duplicates.getByText("Workers paused: correlation.scan"),
  ).toBeVisible();
  await expect(
    duplicates.getByRole("button", { name: "Delete kept data" }),
  ).toBeVisible();

  const embeddings = component.getByTestId("feature-row-embeddings");
  await expect(embeddings.getByText("On", { exact: true })).toBeVisible();
  // Configured elsewhere, switched here.
  await expect(
    embeddings.getByRole("link", { name: /Model & performance/ }),
  ).toBeVisible();

  // The notice another page would show, with the way back.
  await expect(component.getByTestId("feature-off-duplicates")).toBeVisible();
  await expect(
    component.getByRole("link", { name: "Turn on in Settings → Cleanup" }),
  ).toBeVisible();
});

test("turning off asks keep or delete, and keep is the default", async ({
  mount,
  page,
}) => {
  const { puts } = await mockFeaturesApi(page);
  const component = await mount(<FeatureSwitchesHarness />);

  await component.getByTestId("feature-switch-duplicates").click();

  // What stops, in the dialog (a portal outside the mount root).
  await expect(
    page.getByText("Scans still hand off to the AI harness", { exact: false }),
  ).toBeVisible();
  await expect(page.getByTestId("feature-off-keep")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.getByTestId("feature-off-confirm")).toHaveText(
    "Turn off",
  );

  await page.getByTestId("feature-off-confirm").click();

  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0]?.url).toContain("/maintenance/features/duplicates");
  expect(puts[0]?.body).toEqual({ enabled: false });
  await expect(
    component.getByTestId("feature-row-duplicates").getByText("Off · data kept"),
  ).toBeVisible();
  // The rest of the page learns about it without a reload.
  await expect(component.getByTestId("feature-off-duplicates")).toBeVisible();
});

test("choosing delete says what is lost and sends deleteData", async ({
  mount,
  page,
}) => {
  const { puts } = await mockFeaturesApi(page);
  const component = await mount(<FeatureSwitchesHarness />);

  await component.getByTestId("feature-switch-embeddings").click();
  await page.getByTestId("feature-off-delete").click();

  await expect(page.getByTestId("feature-off-confirm")).toHaveText(
    "Turn off and delete",
  );
  await expect(
    page.getByText("document text only comes back by rescanning", {
      exact: false,
    }),
  ).toBeVisible();

  await page.getByTestId("feature-off-confirm").click();

  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0]?.url).toContain("/maintenance/features/embeddings");
  expect(puts[0]?.body).toEqual({ enabled: false, deleteData: true });
});

test("turning back on explains the catch-up before doing it", async ({
  mount,
  page,
}) => {
  const { puts } = await mockFeaturesApi(page, {
    duplicates: { enabled: false, disabledMode: "kept" },
  });
  const component = await mount(<FeatureSwitchesHarness />);

  await component.getByTestId("feature-switch-duplicates").click();
  await expect(
    page.getByText("Runs one full recompute over every asset", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByTestId("feature-on-confirm").click();

  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0]?.body).toEqual({ enabled: true });
  await expect(
    component.getByTestId("feature-row-duplicates").getByText("On", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(component.getByTestId("feature-off-duplicates")).toHaveCount(0);
});
