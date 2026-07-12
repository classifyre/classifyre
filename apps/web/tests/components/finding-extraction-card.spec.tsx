/**
 * Beetle Extractor Tests — FindingExtractionCard component
 *
 * Covers scenarios 01, 02, 03, 07 from beetle-test-scenario-extractor-tests/scenarios/
 */

import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";
import { FindingExtractionCard } from "@/components/finding-extraction-card";

const EXTRACTION_URL = "**/findings/**/extraction*";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function mockExtraction(
  page: Parameters<Parameters<typeof test>[2]>[0]["page"],
  body: Record<string, unknown>,
  status = 200,
) {
  return page.route(EXTRACTION_URL, (route) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    }),
  );
}

function baseExtraction(pipelineResult: Record<string, unknown>) {
  return {
    id: "extraction-1",
    findingId: "find-1",
    customDetectorId: "det-1",
    customDetectorKey: "cust_food",
    sourceId: "source-1",
    assetId: "asset-1",
    runnerId: "runner-1",
    detectorVersion: 1,
    pipelineResult,
    extractedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 01 — entity fields displayed
// ─────────────────────────────────────────────────────────────────────────────

test("renders extracted entity spans", async ({ mount, page }) => {
  await mockExtraction(
    page,
    baseExtraction({
      entities: {
        cuisine: [{ value: "Italian", confidence: 0.92, start: 0, end: 7 }],
      },
      classification: {},
      metadata: { runner: "GLINER2", model: "fastino/gliner2-base-v1" },
    }),
  );

  const component = await mount(<FindingExtractionCard findingId="find-1" />);

  await expect(component.getByText("Extracted Data")).toBeVisible();
  await expect(component.getByText("cuisine")).toBeVisible();
  await expect(component.getByText("Italian")).toBeVisible();
  await expect(component.getByText("92%")).toBeVisible();
  await expect(component.getByText("GLINER2", { exact: true })).toBeVisible();
});

test("renders the runner badge from metadata", async ({ mount, page }) => {
  await mockExtraction(
    page,
    baseExtraction({
      entities: { person: [{ value: "Alice", confidence: 1.0 }] },
      classification: {},
      metadata: { runner: "REGEX" },
    }),
  );

  const component = await mount(<FindingExtractionCard findingId="find-1" />);
  await expect(component.getByText("REGEX")).toBeVisible();
});

test("renders multiple spans for the same entity label", async ({
  mount,
  page,
}) => {
  await mockExtraction(
    page,
    baseExtraction({
      entities: {
        dishes: [
          { value: "pasta carbonara", confidence: 0.8 },
          { value: "tiramisu", confidence: 0.75 },
        ],
      },
      classification: {},
      metadata: {},
    }),
  );

  const component = await mount(<FindingExtractionCard findingId="find-1" />);
  await expect(component.getByText("pasta carbonara")).toBeVisible();
  await expect(component.getByText("tiramisu")).toBeVisible();
});

test("renders classification task outcomes", async ({ mount, page }) => {
  await mockExtraction(
    page,
    baseExtraction({
      entities: {},
      classification: {
        sentiment: { label: "positive", confidence: 0.87 },
      },
      metadata: { runner: "LLM", model: "claude-sonnet-4-5" },
    }),
  );

  const component = await mount(<FindingExtractionCard findingId="find-1" />);
  await expect(component.getByText("sentiment")).toBeVisible();
  await expect(component.getByText("positive", { exact: false })).toBeVisible();
  await expect(component.getByText("87%")).toBeVisible();
  await expect(component.getByText("Model: claude-sonnet-4-5")).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 02 — empty pipeline result hides the card
// ─────────────────────────────────────────────────────────────────────────────

test("hides card when entities and classification are both empty (scenario 02)", async ({
  mount,
  page,
}) => {
  await mockExtraction(
    page,
    baseExtraction({ entities: {}, classification: {}, metadata: {} }),
  );

  const component = await mount(<FindingExtractionCard findingId="find-1" />);
  await expect(component.getByText("Extracted Data")).not.toBeVisible();
});

test("hides card when pipelineResult is empty object (scenario 02)", async ({
  mount,
  page,
}) => {
  await mockExtraction(page, baseExtraction({}));

  const component = await mount(<FindingExtractionCard findingId="find-1" />);
  await expect(component.getByText("Extracted Data")).not.toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 03 — no extraction record → nothing rendered
// ─────────────────────────────────────────────────────────────────────────────

test("renders nothing when API returns 404 (scenario 03)", async ({
  mount,
  page,
}) => {
  await page.route(EXTRACTION_URL, (route) =>
    route.fulfill({ status: 404, body: "" }),
  );

  const component = await mount(
    <FindingExtractionCard findingId="find-missing" />,
  );
  await expect(component.getByText("Extracted Data")).not.toBeVisible();
});

test("renders nothing when API errors (scenario 03)", async ({
  mount,
  page,
}) => {
  await page.route(EXTRACTION_URL, (route) =>
    route.fulfill({ status: 500, body: "" }),
  );

  const component = await mount(
    <FindingExtractionCard findingId="find-error" />,
  );
  await expect(component.getByText("Extracted Data")).not.toBeVisible();
});
