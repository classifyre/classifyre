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

test("a deep link to a tab that renders late opens it once it appears", async ({
  mount,
  page,
}) => {
  // Settings → Access renders its tab only once the person's permissions have
  // loaded; a link to ?tab=access opened General when they came late.
  await page.evaluate(() => {
    window.history.replaceState(null, "", "/harness?tab=access");
  });

  const component = await mount(<UrlTabsHarness lateAccessMs={400} />);

  await expect(component.getByText("Access content")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("tab")).toBe("access");
});

test("a tab picked before the deep-linked one appears is kept", async ({
  mount,
  page,
}) => {
  await page.evaluate(() => {
    window.history.replaceState(null, "", "/harness?tab=access");
  });

  const component = await mount(<UrlTabsHarness lateAccessMs={1500} />);
  await component.getByRole("tab", { name: "Configuration" }).click();
  await expect(component.getByRole("tab", { name: "Access" })).toBeVisible();

  await expect(component.getByText("Configuration content")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("tab")).toBe("config");
});
