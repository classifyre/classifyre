import { expect, test } from "@playwright/experimental-ct-react";
import { DataRequestCanvasHarness } from "./fixtures/data-request-canvas-harness";

test("adds two tables (one locked), joins them, ticks columns, updates SQL live, and keeps requester read-only", async ({
  mount,
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.route("**/api/**", async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  const component = await mount(<DataRequestCanvasHarness role="requester" />);

  // Locked table is visible in the catalog rail with its lock icon
  await expect(
    component.getByTestId("catalog-locked-crm.public.customers"),
  ).toBeVisible();

  // Add both tables onto the drafting canvas
  await component.getByTestId("add-table-shop.public.orders").click();
  await component.getByTestId("add-table-crm.public.customers").click();

  await expect(component.getByTestId("request-table-node-o")).toBeVisible();
  await expect(component.getByTestId("request-table-node-c")).toBeVisible();

  // Before joining, disconnected-table diagnostic is shown
  await expect(
    component.getByTestId("sql-diagnostic-disconnected_table"),
  ).toBeVisible();

  // Join orders.customer_id = customers.id
  await component
    .getByTestId("harness-join-orders-customers")
    .click({ force: true });

  await expect(
    component.getByTestId("sql-diagnostic-disconnected_table"),
  ).toHaveCount(0);

  // Untick email on customers so it leaves the SELECT list
  await component.getByTestId("col-check-c-email").click();

  // Requester sees SQL read-only and has no Preview tab
  const sqlEditor = component.getByTestId("sql-editor");
  await expect(sqlEditor).toHaveAttribute("data-readonly", "true");
  await expect(component.getByTestId("tab-preview")).toHaveCount(0);
  await expect(component.getByTestId("sql-save-btn")).toHaveCount(0);

  // Verify generated SQL text (textarea fallback or Monaco lines)
  await expect(sqlEditor).toContainText("shop.public.orders");
  await expect(sqlEditor).toContainText("INNER JOIN crm.public.customers");

  expect(pageErrors).toEqual([]);
});

test("allows data team members to edit SQL and open the Preview tab", async ({
  mount,
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.route("**/api/**", async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  const component = await mount(<DataRequestCanvasHarness role="team" />);
  await expect(component.getByTestId("sql-editor")).toHaveAttribute(
    "data-readonly",
    "false",
  );
  await expect(component.getByTestId("tab-preview")).toBeVisible();
  await expect(component.getByTestId("request-claim-btn")).toBeVisible();
  await expect(component.getByTestId("request-publish-btn")).toBeVisible();

  expect(pageErrors).toEqual([]);
});
