import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";
import { CustomDetectorEditor } from "@/components/custom-detector-editor";

async function mockCustomDetectorList(
  page: import("@playwright/test").Page,
  detectors: Array<Record<string, unknown>> = [],
) {
  await page.route("**/custom-detectors*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/custom-detectors")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(detectors),
      });
      return;
    }

    await route.continue();
  });
}

test("training examples textarea preserves incomplete lines while editing", async ({
  mount,
  page,
}) => {
  await mockCustomDetectorList(page);

  const component = await mount(
    <CustomDetectorEditor
      mode="edit"
      submitLabel="Save detector"
      initialValue={{
        id: "detector-1",
        name: "Classifier detector",
        key: "cust_classifier_detector",
        method: "CLASSIFIER",
        isActive: true,
        config: {
          classifier: {
            labels: [{ id: "spam", name: "spam" }],
            training_examples: [],
          },
        },
      }}
      onSubmit={() => {}}
    />,
  );

  const examplesInput = component.getByPlaceholder(
    "risk_term|The contract limits liability...\nspam|Buy this now",
  );

  await examplesInput.fill("spam|");
  await expect(examplesInput).toHaveValue("spam|");
});

test("extractor fields textarea does not normalize typed text back into template state", async ({
  mount,
  page,
}) => {
  await mockCustomDetectorList(page);

  const component = await mount(
    <CustomDetectorEditor
      mode="edit"
      submitLabel="Save detector"
      initialValue={{
        id: "detector-1",
        name: "Ruleset detector",
        key: "cust_ruleset_detector",
        method: "RULESET",
        isActive: true,
        config: {
          ruleset: {
            keyword_rules: [
              {
                id: "kw_main",
                name: "Keywords",
                keywords: ["invoice"],
                case_sensitive: false,
                severity: "medium",
              },
            ],
          },
          extractor: {
            enabled: true,
            fields: [],
            gliner_model: "fastino/gliner2-base-v1",
            content_limit: 4000,
          },
        },
      }}
      onSubmit={() => {}}
    />,
  );

  const extractorFieldsInput = component.getByPlaceholder(
    "vendor_name|string|vendor name||required\ninvoice_id|string||\\bINV-\\d+\\b|optional",
  );

  await extractorFieldsInput.fill("invoice_id");
  await expect(extractorFieldsInput).toHaveValue("invoice_id");
});

test("extractor content limit can be cleared and retyped without snapping back mid-edit", async ({
  mount,
  page,
}) => {
  await mockCustomDetectorList(page);

  const component = await mount(
    <CustomDetectorEditor
      mode="edit"
      submitLabel="Save detector"
      initialValue={{
        id: "detector-1",
        name: "Ruleset detector",
        key: "cust_ruleset_detector",
        method: "RULESET",
        isActive: true,
        config: {
          ruleset: {
            keyword_rules: [
              {
                id: "kw_main",
                name: "Keywords",
                keywords: ["invoice"],
                case_sensitive: false,
                severity: "medium",
              },
            ],
          },
          extractor: {
            enabled: true,
            fields: [],
            gliner_model: "fastino/gliner2-base-v1",
            content_limit: 4000,
          },
        },
      }}
      onSubmit={() => {}}
    />,
  );

  const numberInputs = component.locator('input[type="number"]');
  await expect(numberInputs).toHaveCount(3);
  const contentLimitInput = numberInputs.nth(2);

  await expect(contentLimitInput).toHaveValue("4000");
  await contentLimitInput.press("Backspace");
  await expect(contentLimitInput).toHaveValue("400");
  await contentLimitInput.press("Backspace");
  await expect(contentLimitInput).toHaveValue("40");
  await contentLimitInput.press("Backspace");
  await expect(contentLimitInput).toHaveValue("4");
  await contentLimitInput.press("Backspace");
  await expect(contentLimitInput).toHaveValue("");
  await contentLimitInput.type("512");
  await expect(contentLimitInput).toHaveValue("512");
});

test("step 1 blocks advancing when required identity fields are empty", async ({
  mount,
  page,
}) => {
  await mockCustomDetectorList(page);

  const component = await mount(
    <CustomDetectorEditor
      mode="edit"
      submitLabel="Save detector"
      initialValue={{
        id: "detector-1",
        name: "Ruleset detector",
        key: "cust_ruleset_detector",
        method: "RULESET",
        isActive: true,
        config: {
          ruleset: {
            keyword_rules: [
              {
                id: "kw_main",
                name: "Keywords",
                keywords: ["invoice"],
                case_sensitive: false,
                severity: "medium",
              },
            ],
          },
        },
      }}
      onSubmit={() => {}}
    />,
  );

  await component.getByPlaceholder("Detector name").fill("");
  await component.getByPlaceholder("cust_detector_key").fill("");
  await component.getByRole("button", { name: /save detector/i }).click();

  await expect(component.getByText("Name is required.")).toBeVisible();
  await expect(component.getByText("Key is required.")).toBeVisible();
});

test("step 1 blocks advancing when key already exists", async ({
  mount,
  page,
}) => {
  await mockCustomDetectorList(page, [
    {
      id: "detector-2",
      key: "cust_duplicate",
      name: "Existing detector",
      method: "RULESET",
      isActive: true,
      version: 1,
      config: {},
      createdAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
      findingsCount: 0,
      sourcesUsingCount: 0,
      sourcesWithFindingsCount: 0,
      recentSourceNames: [],
    },
  ]);

  const component = await mount(
    <CustomDetectorEditor
      mode="edit"
      submitLabel="Save detector"
      initialValue={{
        id: "detector-1",
        name: "Ruleset detector",
        key: "cust_ruleset_detector",
        method: "RULESET",
        isActive: true,
        config: {
          ruleset: {
            keyword_rules: [
              {
                id: "kw_main",
                name: "Keywords",
                keywords: ["invoice"],
                case_sensitive: false,
                severity: "medium",
              },
            ],
          },
        },
      }}
      onSubmit={() => {}}
    />,
  );

  await component.getByPlaceholder("cust_detector_key").fill("cust_duplicate");
  await component.getByRole("button", { name: /save detector/i }).click();

  await expect(
    component.getByText("This key is already used by another custom detector."),
  ).toBeVisible();
});

test("json mode is available and disables the step workflow", async ({
  mount,
  page,
}) => {
  await mockCustomDetectorList(page);

  const component = await mount(
    <CustomDetectorEditor
      mode="edit"
      submitLabel="Save detector"
      initialValue={{
        id: "detector-1",
        name: "Ruleset detector",
        key: "cust_ruleset_detector",
        method: "RULESET",
        isActive: true,
        config: {
          ruleset: {
            keyword_rules: [
              {
                id: "kw_main",
                name: "Keywords",
                keywords: ["invoice"],
                case_sensitive: false,
                severity: "medium",
              },
            ],
          },
        },
      }}
      onSubmit={() => {}}
    />,
  );

  await component.getByRole("button", { name: /^json$/i }).click();

  await expect(component.getByText("JSON Editor")).toBeVisible();
  await expect(component.getByText("Method setup")).not.toBeVisible();
  await expect(component.getByText("Pattern & severity")).not.toBeVisible();
});
