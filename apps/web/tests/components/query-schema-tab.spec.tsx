import { expect, test } from "@playwright/experimental-ct-react";
import { QuerySchemaHarness } from "./fixtures/query-schema-harness";

test("QuerySchemaTab: cross-source tables, Find Links, locked table warning, Open in SQL, and Open Table Data", async ({
  mount,
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  const component = await mount(<QuerySchemaHarness />);

  // Add tables from two different sources (Postgres + S3 Lake)
  await component.getByTestId("add-table-shop.public.orders").click();
  await component.getByTestId("add-table-crm.public.customers").click();

  // Locked table notice appears in SQL panel
  await expect(component.getByTestId("vs-locked-tables-notice")).toBeVisible();

  // Find Links wires the cross-source FK
  await component.getByTestId("vs-btn-find-links").click();

  // Open in SQL sends valid generated SQL
  await expect(component.getByTestId("vs-open-in-sql-btn")).toBeEnabled();
  await component.getByTestId("vs-open-in-sql-btn").click();
  await expect(component.getByTestId("harness-opened-sql")).toContainText(
    "FROM shop.public.orders",
  );
  await expect(component.getByTestId("harness-opened-sql")).toContainText(
    "INNER JOIN crm.public.customers",
  );

  // Clicking Open Data on orders table card triggers onOpenTable
  await component.getByTestId("vs-open-data-o").click();
  await expect(component.getByTestId("harness-opened-table")).toHaveText(
    "shop.public.orders",
  );

  expect(pageErrors).toEqual([]);
});
