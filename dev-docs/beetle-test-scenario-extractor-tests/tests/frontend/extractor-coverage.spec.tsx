/**
 * Beetle Extractor Tests — CustomDetectorExtractionCoverage component
 *
 * Covers scenarios 04, 05, 09 from beetle-test-scenario-extractor-tests/scenarios/
 */

import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";
import { CustomDetectorExtractionCoverage } from "@/components/custom-detector-extraction-coverage";

const COVERAGE_URL = "**/custom-detectors/**/extractions/coverage*";

function mockCoverage(
  page: Parameters<Parameters<typeof test>[2]>[0]["page"],
  body: Record<string, unknown>,
  status = 200,
) {
  return page.route(COVERAGE_URL, (route) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    }),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 04 — coverage data displayed
// ─────────────────────────────────────────────────────────────────────────────

test("renders coverage card with fields and rates (scenario 04)", async ({
  mount,
  page,
}) => {
  await mockCoverage(page, {
    customDetectorId: "det-1",
    customDetectorKey: "food_discussion",
    totalFindings: 50,
    findingsWithExtraction: 10,
    coverageRate: 0.2,
    fieldCoverage: [
      { field: "dish", populated: 9, total: 10, rate: 0.9 },
      { field: "cuisine", populated: 5, total: 10, rate: 0.5 },
      { field: "rating", populated: 2, total: 10, rate: 0.2 },
    ],
  });

  const component = await mount(
    <CustomDetectorExtractionCoverage detectorId="det-1" />,
  );

  await expect(component.getByText("Extraction Coverage")).toBeVisible();
  await expect(component.getByText("10 extractions")).toBeVisible();
  await expect(component.getByText("dish")).toBeVisible();
  await expect(component.getByText("cuisine")).toBeVisible();
  await expect(component.getByText("rating")).toBeVisible();
  await expect(component.getByText("9/10")).toBeVisible();
  await expect(component.getByText("5/10")).toBeVisible();
  await expect(component.getByText("2/10")).toBeVisible();
});

test("shows 90% badge for dish field (scenario 04)", async ({
  mount,
  page,
}) => {
  await mockCoverage(page, {
    customDetectorId: "det-1",
    customDetectorKey: "food_discussion",
    totalFindings: 10,
    findingsWithExtraction: 10,
    coverageRate: 1,
    fieldCoverage: [{ field: "dish", populated: 9, total: 10, rate: 0.9 }],
  });

  const component = await mount(
    <CustomDetectorExtractionCoverage detectorId="det-1" />,
  );
  await expect(component.getByText("90%")).toBeVisible();
});

test("shows correct percentage for 50% coverage (scenario 04)", async ({
  mount,
  page,
}) => {
  await mockCoverage(page, {
    customDetectorId: "det-1",
    customDetectorKey: "food_discussion",
    totalFindings: 10,
    findingsWithExtraction: 10,
    coverageRate: 1,
    fieldCoverage: [{ field: "cuisine", populated: 5, total: 10, rate: 0.5 }],
  });

  const component = await mount(
    <CustomDetectorExtractionCoverage detectorId="det-1" />,
  );
  await expect(component.getByText("50%")).toBeVisible();
});

test("handles legacy fieldCoverage shape (scenario 04)", async ({
  mount,
  page,
}) => {
  // Backend may return fieldCoverage instead of fields — normalizeCoverage handles both
  await mockCoverage(page, {
    customDetectorId: "det-1",
    customDetectorKey: "cust_ruleset_detector",
    totalFindings: 10,
    findingsWithExtraction: 3,
    coverageRate: 0.3,
    fieldCoverage: [
      { field: "invoice_id", populated: 2, total: 3, rate: 2 / 3 },
    ],
  });

  const component = await mount(
    <CustomDetectorExtractionCoverage detectorId="det-1" />,
  );
  await expect(component.getByText("Extraction Coverage")).toBeVisible();
  await expect(component.getByText("3 extractions")).toBeVisible();
  await expect(component.getByText("invoice_id")).toBeVisible();
  await expect(component.getByText("2/3")).toBeVisible();
});

test("handles fields shape (scenario 04)", async ({ mount, page }) => {
  // Some responses may use `fields` key instead of `fieldCoverage`
  await mockCoverage(page, {
    customDetectorId: "det-1",
    customDetectorKey: "food_discussion",
    totalExtractions: 5,
    fields: [{ field: "dish", populated: 5, total: 5, rate: 1.0 }],
  });

  const component = await mount(
    <CustomDetectorExtractionCoverage detectorId="det-1" />,
  );
  await expect(component.getByText("dish")).toBeVisible();
  await expect(component.getByText("100%")).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 05 — empty state
// ─────────────────────────────────────────────────────────────────────────────

test("shows empty state when no extractions yet (scenario 05)", async ({
  mount,
  page,
}) => {
  await mockCoverage(page, {
    customDetectorId: "det-1",
    customDetectorKey: "food_discussion",
    totalFindings: 0,
    findingsWithExtraction: 0,
    coverageRate: 0,
    fieldCoverage: [],
  });

  const component = await mount(
    <CustomDetectorExtractionCoverage detectorId="det-1" />,
  );
  await expect(component.getByText("Extraction Coverage")).toBeVisible();
  await expect(component.getByText("No extraction data yet")).toBeVisible();
  await expect(
    component.getByText(
      "Extractions are generated during source scans once an extractor is configured.",
    ),
  ).toBeVisible();
});

test("shows empty state when coverage API errors (scenario 05)", async ({
  mount,
  page,
}) => {
  await page.route(COVERAGE_URL, (route) =>
    route.fulfill({ status: 500, body: "" }),
  );

  const component = await mount(
    <CustomDetectorExtractionCoverage detectorId="det-1" />,
  );
  await expect(component.getByText("No extraction data yet")).toBeVisible();
});

test("shows singular 'extraction' for count of 1 (scenario 04)", async ({
  mount,
  page,
}) => {
  await mockCoverage(page, {
    customDetectorId: "det-1",
    customDetectorKey: "food_discussion",
    totalFindings: 10,
    findingsWithExtraction: 1,
    coverageRate: 0.1,
    fieldCoverage: [{ field: "dish", populated: 1, total: 1, rate: 1.0 }],
  });

  const component = await mount(
    <CustomDetectorExtractionCoverage detectorId="det-1" />,
  );
  await expect(component.getByText("1 extraction")).toBeVisible();
});
