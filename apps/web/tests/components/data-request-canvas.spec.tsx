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

  // Shared Visual Schema Properties & Relations tabs are mounted in Data Requests
  await component.getByTestId("vs-tab-relations").click();
  await expect(component.getByTestId("vs-relations-panel")).toContainText(
    "o.customer_id",
  );
  await component.getByTestId("vs-tab-properties").click();
  await expect(component.getByTestId("vs-properties-table")).toBeVisible();
  await expect(component.getByTestId("vs-properties-table")).toContainText(
    "crm.public.customers",
  );

  expect(pageErrors).toEqual([]);
});

test("supports Find Links, ELK Auto-Arrange, context menu color change, multi-select drag, Escape comment tool exit, and Export JSON round-trip", async ({
  mount,
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.emulateMedia({ reducedMotion: "reduce" });

  await page.route("**/api/**", async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });

  const component = await mount(<DataRequestCanvasHarness role="requester" />);

  // Add both tables
  await component.getByTestId("add-table-shop.public.orders").click();
  await component.getByTestId("add-table-crm.public.customers").click();

  const ordersNode = component.getByTestId("request-table-node-o");
  const customersNode = component.getByTestId("request-table-node-c");
  await expect(ordersNode).toBeVisible();
  await expect(customersNode).toBeVisible();

  // Find Links discovers orders.customer_id -> customers.id
  await component.getByTestId("vs-btn-find-links").click();
  await expect(
    component.getByTestId("sql-diagnostic-disconnected_table"),
  ).toHaveCount(0);
  await component.getByTestId("vs-tab-relations").click();
  await expect(component.getByTestId("vs-relations-panel")).toContainText(
    "o.customer_id",
  );

  // ELK Auto-Arrange repositions connected tables cleanly
  await component.getByTestId("vs-btn-arrange").click();
  await page.getByTestId("vs-arrange-elk").click();
  await expect(ordersNode).toBeVisible();
  await expect(customersNode).toBeVisible();

  // Context menu color change updates the card top accent color
  const beforeColor = await ordersNode.evaluate(
    (el) => getComputedStyle(el).borderTopColor,
  );
  await ordersNode.click({ button: "right" });
  await page.getByRole("menuitem", { name: /Color/i }).hover();
  await page.getByTestId("vs-swatch-amber").click();
  await expect
    .poll(() =>
      ordersNode.evaluate((el) => getComputedStyle(el).borderTopColor),
    )
    .not.toBe(beforeColor);
  // Dismiss the context menu before interacting with toolbar controls
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);

  // Escape exits Comment Pin tool
  const canvas = component.getByTestId("request-canvas");
  await component.getByTestId("request-comment-tool").click();
  await expect(canvas).toHaveClass(/cursor-crosshair/);
  await page.keyboard.press("Escape");
  await expect(canvas).not.toHaveClass(/cursor-crosshair/);

  // Multi-select drag moves both selected tables together
  await canvas.focus();
  await page.keyboard.press("ControlOrMeta+a");
  const beforeOrdersBox = (await ordersNode.boundingBox())!;
  const beforeCustomersBox = (await customersNode.boundingBox())!;
  expect(beforeOrdersBox).toBeTruthy();
  expect(beforeCustomersBox).toBeTruthy();

  await page.mouse.move(
    beforeOrdersBox.x + beforeOrdersBox.width / 2,
    beforeOrdersBox.y + 18,
  );
  await page.mouse.down();
  await page.mouse.move(
    beforeOrdersBox.x + beforeOrdersBox.width / 2 + 80,
    beforeOrdersBox.y + 18 + 60,
    { steps: 6 },
  );
  await page.mouse.up();

  await expect
    .poll(async () => {
      const box = await ordersNode.boundingBox();
      return box ? Math.round(box.x - beforeOrdersBox.x) : 0;
    })
    .toBeGreaterThan(20);
  const afterCustomersBox = (await customersNode.boundingBox())!;
  expect(afterCustomersBox.x - beforeCustomersBox.x).toBeGreaterThan(20);

  // Export JSON round-trip: download, clear canvas, re-import the exported JSON
  await component.getByTestId("vs-btn-export").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("vs-export-json").click(),
  ]);
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();

  await component.getByTestId("vs-btn-clear").click();
  await page.getByTestId("vs-confirm-clear").click();
  await expect(component.getByTestId("request-canvas-empty")).toBeVisible();

  await component
    .locator('input[type="file"][accept*="json"]')
    .setInputFiles(downloadPath!);

  await expect(component.getByTestId("request-table-node-o")).toBeVisible();
  await expect(component.getByTestId("request-table-node-c")).toBeVisible();
  await expect(component.getByTestId("vs-relations-panel")).toContainText(
    "o.customer_id",
  );

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
