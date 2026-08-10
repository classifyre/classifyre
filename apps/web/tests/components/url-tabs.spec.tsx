import { expect, test } from "@playwright/experimental-ct-react";
import { UrlTabsHarness } from "./fixtures/url-tabs-harness";

test("opens a valid deep-linked tab and preserves other query parameters", async ({
  mount,
  page,
}) => {
  await page.evaluate(() => {
    window.history.replaceState(null, "", "/harness?source=sidebar&tab=config");
  });

  const component = await mount(<UrlTabsHarness />);

  await expect(component.getByText("Configuration content")).toBeVisible();
  await component.getByRole("tab", { name: "Activity" }).click();

  await expect
    .poll(() => new URL(page.url()).searchParams.get("tab"))
    .toBe("activity");
  expect(new URL(page.url()).searchParams.get("source")).toBe("sidebar");
});

test("deep links also initialize controlled tabs", async ({ mount, page }) => {
  await page.evaluate(() => {
    window.history.replaceState(null, "", "/harness?tab=config");
  });

  const component = await mount(<UrlTabsHarness controlled />);

  await expect(component.getByText("Configuration content")).toBeVisible();
});
