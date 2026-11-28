import { expect, test } from "@playwright/experimental-ct-react";
import { VisualSchemaHarness } from "./fixtures/visual-schema-harness";

test("VisualSchema engine: generate, Find Links, Pan/Select dock, MiniMap, context menu color & multi-select, FK rail icon, and governance badges", async ({
  mount,
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.emulateMedia({ reducedMotion: "reduce" });

  const component = await mount(<VisualSchemaHarness />);

  // Catalog rail column preview renders both PK and FK icons
  const ordersCatalogRow = component.getByTestId(
    "catalog-table-shop.public.orders",
  );
  await ordersCatalogRow
    .getByRole("button", { name: "orders", exact: true })
    .click();
  await expect(ordersCatalogRow.getByLabel("PK")).toBeVisible();
  await expect(ordersCatalogRow.getByLabel("FK")).toBeVisible();

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

  // Context menu color change updates the card accent color
  const beforeColor = await ordersNode.evaluate(
    (el) => getComputedStyle(el).borderTopColor,
  );
  await ordersNode.click({ button: "right" });
  await page.getByRole("menuitem", { name: /Color/i }).hover();
  await page.getByTestId("vs-swatch-violet").click();
  await expect
    .poll(() =>
      ordersNode.evaluate((el) => getComputedStyle(el).borderTopColor),
    )
    .not.toBe(beforeColor);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);

  // Multi-select context menu: Collapse applies to all selected cards
  await canvas.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await ordersNode.click({ button: "right" });
  await page.getByRole("menuitem", { name: /Collapse/i }).click();
  await expect(component.getByTestId("col-row-o-id")).toHaveCount(0);
  await expect(component.getByTestId("col-row-c-id")).toHaveCount(0);

  // Expand both back via multi-select context menu
  await ordersNode.click({ button: "right" });
  await page.getByRole("menuitem", { name: /Expand/i }).click();
  await expect(component.getByTestId("col-row-o-id")).toBeVisible();
  await expect(component.getByTestId("col-row-c-id")).toBeVisible();

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

test("VisualSchema light and dark themes render distinct readable token contrasts without legacy sky-blue colors", async ({
  mount,
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  const readThemeTokens = async (
    root: ReturnType<typeof page.locator>,
    node: ReturnType<typeof page.locator>,
  ) => {
    await node.click({ button: "right" });
    await page.getByRole("menuitem", { name: /Color/i }).hover();
    await page.getByTestId("vs-swatch-amber").click();
    await page.keyboard.press("Escape");

    return root.evaluate((el) => {
      const flow = el.querySelector(".react-flow") ?? el;
      const card = el.querySelector('[data-testid="request-table-node-o"]');
      const flowStyle = getComputedStyle(flow);
      const cardStyle = card ? getComputedStyle(card) : null;
      return {
        edgeStroke: flowStyle.getPropertyValue("--xy-edge-stroke").trim(),
        edgeSelected: flowStyle
          .getPropertyValue("--xy-edge-stroke-selected")
          .trim(),
        cbSelect: flowStyle.getPropertyValue("--cb-select").trim(),
        cbEdge: flowStyle.getPropertyValue("--cb-edge").trim(),
        amberBorder: cardStyle?.borderTopColor ?? "",
      };
    });
  };

  const light = await mount(<VisualSchemaHarness dark={false} />);
  await light.getByTestId("add-table-shop.public.orders").click();
  const lightTokens = await readThemeTokens(
    light,
    light.getByTestId("request-table-node-o"),
  );
  expect(lightTokens.cbSelect).toBe("#4d7c0f");
  expect(lightTokens.cbEdge).toBe("#78716c");
  expect(lightTokens.amberBorder).toBe("rgb(217, 119, 6)");
  expect(lightTokens.amberBorder).not.toBe("rgb(2, 132, 199)");
  await light.unmount();

  const dark = await mount(<VisualSchemaHarness dark />);
  await dark.getByTestId("add-table-shop.public.orders").click();
  const darkTokens = await readThemeTokens(
    dark,
    dark.getByTestId("request-table-node-o"),
  );
  expect(darkTokens.cbSelect).toBe("#b7ff00");
  expect(darkTokens.cbEdge).toBe("#8a8a8a");
  expect(darkTokens.amberBorder).toBe("rgb(251, 191, 36)");
  expect(darkTokens.amberBorder).not.toBe(lightTokens.amberBorder);
  expect(darkTokens.cbSelect).not.toBe(lightTokens.cbSelect);
  expect(darkTokens.amberBorder).not.toBe("rgb(2, 132, 199)");

  expect(pageErrors).toEqual([]);
});
