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

function notFound(page: Parameters<Parameters<typeof test>[2]>[0]["page"]) {
  return page.route(EXTRACTION_URL, (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 01 — fields displayed
// ─────────────────────────────────────────────────────────────────────────────

test("renders extracted string field", async ({ mount, page }) => {
  await mockExtraction(page, {
    findingId: "find-1",
    extractionMethod: "CLASSIFIER_GLINER",
    extractedData: { cuisine: "Italian" },
    populatedFields: ["cuisine"],
    fieldCount: 1,
    extractedAt: new Date().toISOString(),
  });

  const component = await mount(<FindingExtractionCard findingId="find-1" />);

  await expect(component.getByText("Extracted Data")).toBeVisible();
  await expect(component.getByText("cuisine")).toBeVisible();
  await expect(component.getByText("Italian")).toBeVisible();
  await expect(component.getByText("Classifier + GLiNER")).toBeVisible();
});

test("renders GLiNER method badge", async ({ mount, page }) => {
  await mockExtraction(page, {
    findingId: "find-1",
    extractionMethod: "GLINER",
    extractedData: { person: "Alice" },
    populatedFields: ["person"],
    fieldCount: 1,
    extractedAt: new Date().toISOString(),
  });

  const component = await mount(<FindingExtractionCard findingId="find-1" />);
  await expect(component.getByText("GLiNER")).toBeVisible();
});

test("renders Regex method badge", async ({ mount, page }) => {
  await mockExtraction(page, {
    findingId: "find-1",
    extractionMethod: "REGEX",
    extractedData: { amount: "29.99" },
    populatedFields: ["amount"],
    fieldCount: 1,
    extractedAt: new Date().toISOString(),
  });

  const component = await mount(<FindingExtractionCard findingId="find-1" />);
  await expect(component.getByText("Regex")).toBeVisible();
});

test("renders array field as comma-joined string (scenario 07)", async ({
  mount,
  page,
}) => {
  await mockExtraction(page, {
    findingId: "find-1",
    extractionMethod: "CLASSIFIER_GLINER",
    extractedData: { dishes: ["pasta carbonara", "tiramisu"] },
    populatedFields: ["dishes"],
    fieldCount: 1,
    extractedAt: new Date().toISOString(),
  });

  const component = await mount(<FindingExtractionCard findingId="find-1" />);
  await expect(component.getByText("pasta carbonara, tiramisu")).toBeVisible();
});

test("renders multiple fields", async ({ mount, page }) => {
  await mockExtraction(page, {
    findingId: "find-1",
    extractionMethod: "CLASSIFIER_GLINER",
    extractedData: {
      dish: "risotto",
      cuisine: "Italian",
      rating: 4,
    },
    populatedFields: ["dish", "cuisine", "rating"],
    fieldCount: 3,
    extractedAt: new Date().toISOString(),
  });

  const component = await mount(<FindingExtractionCard findingId="find-1" />);
  await expect(component.getByText("dish")).toBeVisible();
  await expect(component.getByText("risotto")).toBeVisible();
  await expect(component.getByText("cuisine")).toBeVisible();
  await expect(component.getByText("Italian")).toBeVisible();
  await expect(component.getByText("rating")).toBeVisible();
  await expect(component.getByText("4")).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 02 — empty extractedData hides the card
// ─────────────────────────────────────────────────────────────────────────────

test("hides card when all fields are null (scenario 02)", async ({
  mount,
  page,
}) => {
  await mockExtraction(page, {
    findingId: "find-1",
    extractionMethod: "REGEX",
    extractedData: { dish: null, cuisine: "" },
    populatedFields: [],
    fieldCount: 0,
    extractedAt: new Date().toISOString(),
  });

  const component = await mount(<FindingExtractionCard findingId="find-1" />);
  // Card header should not be visible since no entries pass the filter
  await expect(component.getByText("Extracted Data")).not.toBeVisible();
});

test("hides card when extractedData is empty object (scenario 02)", async ({
  mount,
  page,
}) => {
  await mockExtraction(page, {
    findingId: "find-1",
    extractionMethod: "REGEX",
    extractedData: {},
    populatedFields: [],
    fieldCount: 0,
    extractedAt: new Date().toISOString(),
  });

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
  await notFound(page);

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

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 07 — field type filtering
// ─────────────────────────────────────────────────────────────────────────────

test("filters out null values, shows only populated fields (scenario 07)", async ({
  mount,
  page,
}) => {
  await mockExtraction(page, {
    findingId: "find-1",
    extractionMethod: "GLINER",
    extractedData: {
      cuisine: "French",
      rating: null,
      source: "",
    },
    populatedFields: ["cuisine"],
    fieldCount: 3,
    extractedAt: new Date().toISOString(),
  });

  const component = await mount(<FindingExtractionCard findingId="find-1" />);
  await expect(component.getByText("cuisine")).toBeVisible();
  await expect(component.getByText("French")).toBeVisible();
  // null and empty string fields should not appear
  await expect(component.getByText("rating")).not.toBeVisible();
  await expect(component.getByText("source")).not.toBeVisible();
});

test("renders boolean field value (scenario 07)", async ({ mount, page }) => {
  await mockExtraction(page, {
    findingId: "find-1",
    extractionMethod: "REGEX",
    extractedData: { is_vegetarian: true },
    populatedFields: ["is_vegetarian"],
    fieldCount: 1,
    extractedAt: new Date().toISOString(),
  });

  const component = await mount(<FindingExtractionCard findingId="find-1" />);
  await expect(component.getByText("is_vegetarian")).toBeVisible();
  await expect(component.getByText("true")).toBeVisible();
});

test("renders number field value (scenario 07)", async ({ mount, page }) => {
  await mockExtraction(page, {
    findingId: "find-1",
    extractionMethod: "REGEX",
    extractedData: { price: 29.99 },
    populatedFields: ["price"],
    fieldCount: 1,
    extractedAt: new Date().toISOString(),
  });

  const component = await mount(<FindingExtractionCard findingId="find-1" />);
  await expect(component.getByText("price")).toBeVisible();
  await expect(component.getByText("29.99")).toBeVisible();
});
