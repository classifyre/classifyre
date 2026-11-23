import { expect, test } from "@playwright/experimental-ct-react";
import { QueryGuiHarness } from "./fixtures/query-gui-harness";

test("renders hierarchical folders, opens source & asset tabs, preloads 200-row SQL, and edits in main query tab", async ({
  mount,
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  const startedSqls: string[] = [];

  // Stub backend endpoints touched by Source and Asset tabs.
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const method = route.request().method();

    if (pathname.endsWith("/query-runs") && method === "POST") {
      const body = route.request().postDataJSON() as { sql?: string };
      if (body?.sql) startedSqls.push(body.sql);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "run-1",
          status: "SUCCESS",
          sql: body?.sql ?? "",
          rowCount: 0,
          createdAt: new Date().toISOString(),
        }),
      });
    }

    if (pathname.endsWith("/query-runs/run-1/result")) {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "no-arrow-in-unit-test" }),
      });
    }

    if (pathname.endsWith("/query-runs/run-1")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "run-1",
          status: "CANCELLED",
          sql: startedSqls[startedSqls.length - 1] ?? "",
          createdAt: new Date().toISOString(),
        }),
      });
    }

    if (pathname.endsWith("/sources/src-pg")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "src-pg",
          name: "Shop Postgres",
          type: "POSTGRESQL",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      });
    }

    if (pathname.endsWith("/assets/asset-orders")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "asset-orders",
          name: "orders",
          assetType: "TABLE",
          sourceId: "src-pg",
          sourceType: "POSTGRESQL",
          metadata: { row_count: 42 },
        }),
      });
    }

    if (pathname.includes("/runners/search")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [], total: 0 }),
      });
    }

    if (pathname.includes("/assets/search/charts")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          totals: {
            totalAssets: 2,
            newAssets: 0,
            updatedAssets: 0,
            unchangedAssets: 2,
          },
          topAssetsByFindings: [],
          topSourcesByAssetVolume: [],
        }),
      });
    }

    // Governance / usage / access endpoints: return 404 so optional cards stay quiet.
    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ message: "not found" }),
    });
  });

  const component = await mount(<QueryGuiHarness />);

  // 1. Hierarchical folders: single-schema source renders "Tables" folder; multi-schema renders schema folders.
  await expect(
    component.getByTestId("catalog-folder-src-s3:default"),
  ).toContainText("Tables");
  await expect(
    component.getByTestId("catalog-folder-src-pg:public"),
  ).toContainText("public");
  await expect(
    component.getByTestId("catalog-folder-src-pg:analytics"),
  ).toContainText("analytics");

  // 2. Pinned SQL Query tab cannot be closed.
  await expect(
    component.getByRole("button", { name: "Close SQL Query" }),
  ).toHaveCount(0);

  // 3. Double-clicking a source opens a closable Source tab listing its tables.
  await component.getByTestId("catalog-source-src-pg").dblclick();
  await expect(
    component.getByRole("tab", { name: "Shop Postgres" }),
  ).toHaveAttribute("data-state", "active");
  await expect(
    component.getByTestId("source-table-row-shop_pg.public.orders"),
  ).toBeVisible();

  // 4. Clicking a table opens a closable Asset tab and preloads SELECT * ... LIMIT 200.
  await component.getByTestId("catalog-table-shop_pg.public.orders").click();
  await expect(
    component.getByRole("tab", { name: "orders" }),
  ).toHaveAttribute("data-state", "active");

  await expect(component.getByTestId("asset-sql-preview")).toContainText(
    "SELECT *\nFROM shop_pg.public.orders\nLIMIT 200",
  );
  await expect.poll(() => startedSqls.length).toBeGreaterThan(0);
  expect(startedSqls[0]).toBe("SELECT *\nFROM shop_pg.public.orders\nLIMIT 200");

  // 5. Clicking "Edit in SQL" navigates back to the pinned main Query tab with the SQL loaded.
  await component.getByTestId("asset-edit-in-query").click();
  await expect(
    component.getByRole("tab", { name: "SQL Query" }),
  ).toHaveAttribute("data-state", "active");
  await expect(component.getByTestId("main-query-sql")).toHaveText(
    "SELECT *\nFROM shop_pg.public.orders\nLIMIT 200",
  );

  // 6. Dynamic tabs can be closed while SQL Query stays pinned.
  await component.getByRole("button", { name: "Close orders" }).click();
  await expect(component.getByRole("tab", { name: "orders" })).toHaveCount(0);
  await component.getByRole("button", { name: "Close Shop Postgres" }).click();
  await expect(
    component.getByRole("tab", { name: "Shop Postgres" }),
  ).toHaveCount(0);
  await expect(
    component.getByRole("tab", { name: "SQL Query" }),
  ).toBeVisible();

  expect(pageErrors).toEqual([]);
});
