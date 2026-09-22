import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";
import { WorkerQueuesCardHarness } from "./fixtures/worker-queues-card-harness";

// Derive the page fixture type from the component-test `test` so this helper
// stays in sync with the playwright-core version the fixtures use.
type CtPage = Parameters<Parameters<typeof test>[2]>[0]["page"];

const LONG_IDS = [
  "classifyre-worker-7fb56894ff-lm4zp:1",
  "classifyre-worker-856bb85cf9-8hk9c:1",
  "classifyre-worker-74c8cd8695-46vbt:1",
];

function queueEntry(
  queue: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    queue,
    status: "idle",
    paused: false,
    activeJobs: 0,
    queuedCount: 0,
    deferredCount: 0,
    totalCount: 0,
    runCount: 10,
    failureCount: 0,
    lastError: null,
    lastErrorAt: null,
    instances: [],
    ...over,
  };
}

const overview = {
  concurrencyLimit: 4,
  slotWaitTimeoutSeconds: 900,
  queues: [
    queueEntry("auto-schedule.tick", {
      queuedCount: 3,
      instances: LONG_IDS.map((instanceId) => ({
        instanceId,
        status: "idle",
        elapsedMs: null,
        lastDurationMs: null,
      })),
    }),
    queueEntry("autopilot.cycle"),
    queueEntry("correlation.scan", { paused: true, heldBy: "duplicates" }),
  ],
};

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

async function mockQueuesApi(page: CtPage) {
  const purged: string[] = [];
  await page.route("**/instance-settings", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(settings),
    });
  });
  await page.route("**/worker-queues/*/purge", async (route) => {
    purged.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ queue: "auto-schedule.tick", droppedQueued: 3 }),
    });
  });
  await page.route("**/worker-queues", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(overview),
    });
  });
  return { purged };
}

test("workers render truncated with the full list in a tooltip", async ({
  mount,
  page,
}) => {
  await mockQueuesApi(page);
  const component = await mount(<WorkerQueuesCardHarness />);

  const tables = component.getByRole("table");
  await expect(tables).toHaveCount(1);
  const row = tables.getByRole("row", { name: /auto-schedule\.tick/ });
  await expect(row).toBeVisible();
  // Truncated cell shows the joined ids; the tooltip carries each in full.
  await expect(row.getByText(/classifyre-worker-7fb56894ff/)).toBeVisible();
  await row.getByText(/classifyre-worker-7fb56894ff/).hover();
  await expect(
    page
      .getByRole("tooltip")
      .getByText("classifyre-worker-856bb85cf9-8hk9c:1", { exact: true }),
  ).toBeVisible();
});

test("purge is offered on backlogged queues and confirms side effects", async ({
  mount,
  page,
}) => {
  const { purged } = await mockQueuesApi(page);
  const component = await mount(<WorkerQueuesCardHarness />);

  const tables = component.getByRole("table");
  const backlogged = tables.getByRole("row", { name: /auto-schedule\.tick/ });
  const idle = tables.getByRole("row", { name: /autopilot\.cycle/ });
  await expect(
    backlogged.getByRole("button", { name: "Purge", exact: true }),
  ).toBeVisible();
  // No backlog, no purge button — only pause/resume stays.
  await expect(
    idle.getByRole("button", { name: "Purge", exact: true }),
  ).toHaveCount(0);

  await backlogged
    .getByRole("button", { name: "Purge", exact: true })
    .click();
  // The dialog renders in a portal outside the mount root.
  await expect(
    page.getByText("are not re-queued", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Drop queued jobs", exact: true })
    .click();

  // The harness mounts no sonner Toaster, so assert the dialog closed
  // (which only happens after the purge resolves) and the request went out.
  await expect(
    page.getByText("are not re-queued", { exact: false }),
  ).toHaveCount(0);
  expect(purged).toHaveLength(1);
  expect(purged[0]).toContain("auto-schedule.tick/purge");
});

test("a queue held by a feature switch cannot be resumed here", async ({
  mount,
  page,
}) => {
  await mockQueuesApi(page);
  const component = await mount(<WorkerQueuesCardHarness />);

  const held = component
    .getByRole("table")
    .getByRole("row", { name: /correlation\.scan/ });
  await expect(held.getByText("Held · Duplicate detection off")).toBeVisible();
  // No resume button: the way back is the switch.
  await expect(held.getByRole("button", { name: "Resume" })).toHaveCount(0);
  await expect(
    held.getByRole("link", { name: "Turn on in Cleanup" }),
  ).toBeVisible();
});
