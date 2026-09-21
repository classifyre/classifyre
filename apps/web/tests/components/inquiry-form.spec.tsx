import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";
import { InquiryForm } from "@/components/inquiry-form";
import { InstanceSettingsProvider } from "@/components/instance-settings-provider";

type CtPage = Parameters<Parameters<typeof test>[2]>[0]["page"];

const MATCH_OPTIONS = {
  sources: [
    {
      id: "s1",
      name: "Wiki",
      type: "CONFLUENCE",
      assetCount: 10,
      openFindingCount: 18,
    },
  ],
  customDetectors: [
    {
      key: "shell",
      name: "Shell risk",
      pipelineType: "TAG",
      answerDimension: "matchedContent",
      suggestedMatcher: "findingValueRegex",
      findingTypes: ["tag:Shell risk"],
      openFindings: 7,
    },
    {
      key: "solvency",
      name: "Solvency outlook",
      pipelineType: "LLM",
      answerDimension: "findingType",
      suggestedMatcher: "findingTypes",
      findingTypes: ["insolvenzgefahr_hoch", "stabil"],
      openFindings: 125,
    },
  ],
  findingTypes: [
    { value: "ssn", detectorType: "PII", count: 10 },
    { value: "email", detectorType: "PII", count: 5 },
    { value: "aws_key", detectorType: "SECRETS", count: 3 },
    { value: "tag:Shell risk", detectorType: "CUSTOM", count: 7 },
    { value: "insolvenzgefahr_hoch", detectorType: "CUSTOM", count: 42 },
  ],
};

async function mockInquiryApi(page: CtPage) {
  await page.route("**/inquiries/match-options**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MATCH_OPTIONS),
    });
  });
  await page.route("**/inquiries/preview", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ total: 0, sample: [], diagnostics: [] }),
    });
  });
}

async function mountForm(
  mount: (element: React.JSX.Element) => Promise<unknown>,
) {
  await mount(
    <InstanceSettingsProvider>
      <InquiryForm mode="create" />
    </InstanceSettingsProvider>,
  );
}

/**
 * With PII picked in the merged detector select, the finding-type picker
 * must offer PII rows only — not every observed type.
 */
test("finding-type list follows the detector selection", async ({
  mount,
  page,
}) => {
  await mockInquiryApi(page);
  await mountForm(mount);

  const triggers = page.getByRole("combobox");
  await expect(triggers.nth(1)).toBeEnabled();

  // Pick PII in the detectors multi-select.
  await triggers.nth(1).click();
  await page.getByRole("option", { name: /PII/ }).click();
  await page.keyboard.press("Escape");

  // The trigger now badges the selection.
  await expect(triggers.nth(1)).toContainText("PII");

  // The finding-type list offers PII rows only.
  await triggers.nth(2).click();
  await expect(page.getByRole("option", { name: /^ssn/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /^email/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /^aws_key/ })).toHaveCount(
    0,
  );
});

/**
 * With one custom detector picked, the finding-type picker must offer only
 * the types that detector emits — not every other custom detector's types.
 */
test("finding-type list narrows to the selected custom detector", async ({
  mount,
  page,
}) => {
  await mockInquiryApi(page);
  await mountForm(mount);

  const triggers = page.getByRole("combobox");
  await expect(triggers.nth(1)).toBeEnabled();

  await triggers.nth(1).click();
  await page.getByRole("option", { name: /Shell risk/ }).click();
  await page.keyboard.press("Escape");

  await expect(triggers.nth(1)).toContainText("Shell risk");

  await triggers.nth(2).click();
  await expect(
    page.getByRole("option", { name: /^tag:Shell risk/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: /^insolvenzgefahr_hoch/ }),
  ).toHaveCount(0);
  await expect(page.getByRole("option", { name: /^ssn/ })).toHaveCount(0);
});
