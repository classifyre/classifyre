import { expect, test } from "@playwright/experimental-ct-react";
import { VisualSchemaHarness } from "./fixtures/visual-schema-harness";

test("VisualSchema engine: generate, Find Links, Pan/Select dock, MiniMap, context menu, and governance badges", async ({
  mount,
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.emulateMedia({ reducedMotion: "reduce" });

  const component = await mount(<VisualSchemaHarness />);

  // Place both tables via catalog rail
  await component.getByTestId("add-table-shop.public.orders").click();
  await component.getByTestId("add-table-shop.public.customers").click();

  const ordersNode = component.getByTestId("request-table-node-o");
  const customersNode = component.getByTestId("request-table-node-c");
  await expect(ordersNode).toBeVisible();
  await expect(customersNode).toBeVisible();

  // Governance hidden columns footer renders count only
  await expect(component.getByTestId("vs-hidden-cols-o")).toBeVisible();

  // Find Links discovers the catalog FK between orders.customer_id and customers.id
  await component.getByTestId("vs-btn-find-links").click();
  await component.getByTestId("vs-tab-relations").click();
  await expect(component.getByTestId("vs-relations-panel")).toContainText(
    "o.customer_id",
  );

  // Pan vs Select mode toggle via dock
  const canvas = component.getByTestId("request-canvas");
  await expect(canvas).toHaveAttribute("data-interaction-mode", "pan");
  await component.getByTestId("vs-mode-select").click();
  await expect(canvas).toHaveAttribute("data-interaction-mode", "select");
  await component.getByTestId("vs-mode-pan").click();
  await expect(canvas).toHaveAttribute("data-interaction-mode", "pan");

  // MiniMap toggles cleanly
  await expect(component.locator(".react-flow__minimap")).toHaveCount(0);
  await component.getByTestId("vs-toggle-minimap").click();
  await expect(component.locator(".react-flow__minimap")).toBeVisible();
  await component.getByTestId("vs-toggle-minimap").click();
  await expect(component.locator(".react-flow__minimap")).toHaveCount(0);

  // Semantic zoom LOD: zoom out repeatedly below 0.45 and verify compact LOD switches on
  await expect(ordersNode).toHaveAttribute("data-lod", "full");
  const zoomOutBtn = component.getByTestId("vs-zoom-out");
  for (let i = 0; i < 8; i += 1) {
    await zoomOutBtn.click();
  }
  await expect(ordersNode).toHaveAttribute("data-lod", "compact");
  await component.getByTestId("vs-zoom-percent").click();
  await expect(ordersNode).toHaveAttribute("data-lod", "full");

  // Context menu opens on right-click and can remove links
  await ordersNode.click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("menuitem", { name: /Remove links/i }).click();
  await expect(component.getByTestId("vs-relations-panel")).toContainText(
    "Active joins (0)",
  );
  await expect(component.getByTestId("vs-relations-panel")).toContainText(
    "Suggested links (1)",
  );

  expect(pageErrors).toEqual([]);
});
