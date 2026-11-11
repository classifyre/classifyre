import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";
import { DataAccessHarness } from "./fixtures/data-access-harness";
import { signedInAs } from "./fixtures/signed-in";

type CtPage = Parameters<Parameters<typeof test>[2]>[0]["page"];

const grant = (fields: Record<string, unknown>) => ({
  subjectType: "group",
  roleKey: "data-reader",
  expiresAt: null,
  inherited: false,
  ...fields,
});

// One workspace (ws-1) with a source (s-shop) holding two tables.
const grants = [
  grant({ id: "g-orders", subjectId: "fin", subjectLabel: "/finance", scopeType: "asset", scopeId: "ws-1/a-orders", scopeLabel: "orders", sourceId: "s-shop" }),
  grant({ id: "g-items", subjectId: "ops", subjectLabel: "/ops", scopeType: "asset", scopeId: "ws-1/a-items", scopeLabel: "items", sourceId: "s-shop" }),
  grant({ id: "g-source", subjectId: "legal", subjectLabel: "/legal", scopeType: "source", scopeId: "ws-1/s-shop", scopeLabel: "Shop lake" }),
  grant({ id: "g-other", subjectId: "hr", subjectLabel: "/hr", scopeType: "source", scopeId: "ws-1/s-crm", scopeLabel: "CRM" }),
  grant({ id: "g-ws", subjectId: "analysts", subjectLabel: "/analysts", scopeType: "workspace", scopeId: "ws-1", scopeLabel: "This workspace" }),
  grant({ id: "g-viewer", subjectId: "everyone", subjectLabel: "/everyone", roleKey: "viewer", scopeType: "workspace", scopeId: "ws-1", scopeLabel: "This workspace" }),
  grant({ id: "g-tenant", subjectId: "auditors", subjectLabel: "/auditors", scopeType: "tenant", scopeId: "t1", scopeLabel: "Acme", inherited: true }),
];

async function mockApi(page: CtPage) {
  const posted: unknown[] = [];
  const audit: string[] = [];
  const json = (body: unknown) => ({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
  await page.route("**/namespaces", (route) =>
    route.fulfill(json([{ id: "ws-1", slug: "shop", name: "Shop" }])),
  );
  await page.route("**/access/grants", async (route) => {
    if (route.request().method() === "POST") {
      posted.push(route.request().postDataJSON());
      return route.fulfill(json(grants[0]));
    }
    return route.fulfill(json(grants));
  });
  await page.route("**/access/groups", (route) =>
    route.fulfill(json([{ id: "sales", name: "sales", path: "/sales", parentId: null }])),
  );
  await page.route("**/*audit-events*", (route) => {
    audit.push(new URL(route.request().url()).searchParams.get("resource") ?? "");
    return route.fulfill(json({ items: [], total: 0, skip: 0, limit: 50 }));
  });
  await page.route("**/actors/resolve?*", (route) => route.fulfill(json([])));
  return { posted, audit };
}

const ADMIN = ["workspace.view", "access.view", "access.manage", "activity.view"];

test("a table lists the grants that open it, and gives access to it alone", async ({
  mount,
  page,
}) => {
  await signedInAs(page, ADMIN);
  const { posted, audit } = await mockApi(page);
  const component = await mount(
    <DataAccessHarness
      scope={{ kind: "asset", assetId: "a-orders", sourceId: "s-shop", name: "orders" }}
    />,
  );

  const table = component.getByTestId("data-access-table");
  // The table, its source, the workspace and the tenant: data readers only.
  await expect(table.getByText("/finance")).toBeVisible();
  await expect(table.getByText("/legal")).toBeVisible();
  await expect(table.getByText("/analysts")).toBeVisible();
  await expect(table.getByText("/auditors")).toBeVisible();
  await expect(table.getByText("/ops")).toHaveCount(0);
  await expect(table.getByText("/hr")).toHaveCount(0);
  await expect(table.getByText("/everyone")).toHaveCount(0);
  await expect(table.getByText("Shop lake")).toBeVisible();

  await component.getByTestId("data-access-dialog-trigger").click();
  const dialog = page.getByTestId("data-access-dialog");
  await expect(dialog.getByText("on the table orders")).toBeVisible();
  // No scope picker: on a table's tab it is always the table.
  await expect(dialog.getByRole("combobox")).toHaveCount(1);
  await dialog.getByTestId("data-access-group").click();
  await page.getByRole("option", { name: "/sales" }).click();
  await dialog.getByTestId("data-access-give").click();
  await expect.poll(() => posted).toEqual([
    {
      subjectType: "group",
      subjectId: "sales",
      roleKey: "data-reader",
      scopeType: "asset",
      resourceId: "a-orders",
    },
  ]);

  await component.getByTestId("data-activity-tab").click();
  await expect.poll(() => audit).toContain("asset:a-orders");
});

test("a source lists grants on it and on any of its tables, and gives the whole source", async ({
  mount,
  page,
}) => {
  await signedInAs(page, ADMIN);
  const { posted, audit } = await mockApi(page);
  const component = await mount(
    <DataAccessHarness scope={{ kind: "source", sourceId: "s-shop", name: "Shop lake" }} />,
  );

  const table = component.getByTestId("data-access-table");
  await expect(table.getByText("/finance")).toBeVisible();
  await expect(table.getByText("/ops")).toBeVisible();
  await expect(table.getByText("/legal")).toBeVisible();
  await expect(table.getByText("/hr")).toHaveCount(0);

  await component.getByTestId("data-access-dialog-trigger").click();
  const dialog = page.getByTestId("data-access-dialog");
  await expect(dialog.getByText("the whole source Shop lake")).toBeVisible();
  await dialog.getByTestId("data-access-group").click();
  await page.getByRole("option", { name: "/sales" }).click();
  await dialog.getByTestId("data-access-give").click();
  await expect.poll(() => posted).toEqual([
    expect.objectContaining({ scopeType: "source", resourceId: "s-shop" }),
  ]);

  await component.getByTestId("data-activity-tab").click();
  await expect.poll(() => audit).toContain("source:s-shop");
});

test("the SQL page shows every data grant and gives the whole workspace", async ({
  mount,
  page,
}) => {
  await signedInAs(page, ADMIN);
  const { posted, audit } = await mockApi(page);
  const component = await mount(<DataAccessHarness scope={{ kind: "workspace" }} />);

  const table = component.getByTestId("data-access-table");
  for (const group of ["/finance", "/ops", "/legal", "/hr", "/analysts"]) {
    await expect(table.getByText(group)).toBeVisible();
  }
  await expect(table.getByText("/everyone")).toHaveCount(0);

  await component.getByTestId("data-access-dialog-trigger").click();
  const dialog = page.getByTestId("data-access-dialog");
  await dialog.getByTestId("data-access-group").click();
  await page.getByRole("option", { name: "/sales" }).click();
  await dialog.getByTestId("data-access-give").click();
  await expect.poll(() => posted).toEqual([
    expect.objectContaining({ scopeType: "workspace" }),
  ]);
  expect(JSON.stringify(posted)).not.toContain("resourceId");

  await component.getByTestId("data-activity-tab").click();
  await expect.poll(() => audit).toContain("data");
});

test("without access.view there is neither Access nor Activity", async ({
  mount,
  page,
}) => {
  await signedInAs(page, ["workspace.view", "data.query"]);
  const { audit } = await mockApi(page);
  const component = await mount(
    <DataAccessHarness scope={{ kind: "source", sourceId: "s-shop", name: "Shop lake" }} />,
  );
  await expect(component.getByTestId("data-access")).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(audit).toEqual([]);
});
