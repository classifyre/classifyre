import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";
import { CustomDetectorExtractionCoverage } from "@/components/custom-detector-extraction-coverage";

test("renders backend coverage payload without crashing when fieldCoverage is returned", async ({
  mount,
  page,
}) => {
  await page.route(
    "**/custom-detectors/**/extractions/coverage*",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          customDetectorId: "detector-1",
          customDetectorKey: "cust_ruleset_detector",
          totalFindings: 10,
          findingsWithExtraction: 3,
          coverageRate: 0.3,
          fieldCoverage: [
            {
              field: "invoice_id",
              populated: 2,
              total: 3,
              rate: 2 / 3,
            },
          ],
        }),
      });
    },
  );

  const component = await mount(
    <CustomDetectorExtractionCoverage detectorId="detector-1" />,
  );

  await expect(component.getByText("Extraction Coverage")).toBeVisible();
  await expect(component.getByText("3 extractions")).toBeVisible();
  await expect(component.getByText("invoice_id")).toBeVisible();
  await expect(component.getByText("2/3")).toBeVisible();
});
