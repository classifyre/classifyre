import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";
import { WorkspaceAccessCard } from "@/components/access/workspace-access-card";

type CtPage = Parameters<Parameters<typeof test>[2]>[0]["page"];

const grants = [
  {
    id: "g-tenant",
    subjectType: "group",
    subjectId: "admins",
    subjectLabel: "/admins",
    roleKey: "tenant-admin",
    scopeType: "tenant",
    scopeId: "t1",
    scopeLabel: "Acme",
    expiresAt: null,
    inherited: true,
  },
  {
    id: "g-legal",
    subjectType: "group",
    subjectId: "legal",
    subjectLabel: "/legal",
    roleKey: "viewer",
    scopeType: "workspace",
    scopeId: "ws",
    scopeLabel: "This workspace",
    expiresAt: null,
    inherited: false,
  },
];

async function mockAccess(page: CtPage, capabilities: string[]) {
  const calls: { method: string; url: string; body?: string }[] = [];
  const json = (body: unknown) => ({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
  await page.route("**/access/grants", async (route) => {
    const request = route.request();
    calls.push({
      method: request.method(),
      url: request.url(),
      body: request.postData() ?? undefined,
    });
    await route.fulfill(json(request.method() === "POST" ? grants[1] : grants));
  });
  await page.route("**/access/grants/*", async (route) => {
    calls.push({
      method: route.request().method(),
      url: route.request().url(),
    });
    await route.fulfill({ status: 204, body: "" });
  });
  await page.route("**/access/roles", (route) =>
    route.fulfill(
      json([
        {
          key: "viewer",
          title: "Viewer",
          scopes: ["workspace", "group", "tenant"],
          capabilities: ["workspace.view", "finding.view"],
        },
        {
          key: "tenant-admin",
          title: "Tenant admin",
          scopes: ["tenant"],
          capabilities: ["workspace.view", "access.manage"],
        },
        {
          key: "data-reader",
          title: "Data reader",
          scopes: ["workspace", "group", "tenant", "source", "asset"],
          capabilities: ["data.query", "data.connect"],
        },
      ]),
    ),
  );
  await page.route("**/access/groups", (route) =>
    route.fulfill(
      json([{ id: "sales", name: "sales", path: "/sales", parentId: null }]),
    ),
  );
  await page.route("**/data-query/catalog", (route) =>
    route.fulfill(
      json({
        sources: [
          {
            id: "s-shop",
            name: "Shop lake",
            sqlName: "shop_lake",
            type: "S3_COMPATIBLE_STORAGE",
            queryable: true,
            tables: [
              {
                assetId: "a-orders",
                sourceId: "s-shop",
                name: "orders",
                schema: "shop",
                table: "orders",
                sqlName: "shop_lake.shop.orders",
                queryable: true,
                canQuery: true,
                columns: [],
              },
            ],
          },
        ],
      }),
    ),
  );
  await page.route("**/access/explain?*", (route) =>
    route.fulfill(json([grants[1]])),
  );
  await page.route("**/me", (route) =>
    route.fulfill(
      json({
        actor: {
          id: "user:u1",
          displayName: "Ada Kowalczyk",
          kind: "person",
          via: "oidc",
        },
        capabilities,
      }),
    ),
  );
  return calls;
}

test("lists inherited grants read-only and grants made here with a remove button", async ({
  mount,
  page,
}) => {
  const calls = await mockAccess(page, [
    "workspace.view",
    "access.view",
    "access.manage",
    "source.manage",
  ]);
  const card = await mount(<WorkspaceAccessCard />);

  await expect(card.getByText("/admins")).toBeVisible();
  await expect(card.getByText("Inherited", { exact: true })).toHaveCount(1);
  const remove = card.getByRole("button", { name: "Remove access" });
  await expect(remove).toHaveCount(1);

  await remove.click();
  await expect
    .poll(() =>
      calls.some(
        (c) =>
          c.method === "DELETE" && c.url.endsWith("/access/grants/g-legal"),
      ),
    )
    .toBe(true);
});

test("gives a group a role from the dialog", async ({ mount, page }) => {
  const calls = await mockAccess(page, [
    "workspace.view",
    "access.view",
    "access.manage",
    "source.manage",
  ]);
  const card = await mount(<WorkspaceAccessCard />);

  // Giving access now lives in a dialog opened from the card header.
  await expect(
    card.getByTestId("workspace-grants").getByText("/legal"),
  ).toBeVisible();
  await card.getByRole("button", { name: "Give access" }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "/sales" }).click();
  await dialog.getByRole("button", { name: "Give access" }).click();

  await expect
    .poll(() => calls.find((c) => c.method === "POST")?.body ?? "")
    .toContain('"subjectId":"sales"');
});

test("gives Data reader on one source, until a date, from the same dialog", async ({
  mount,
  page,
}) => {
  const calls = await mockAccess(page, [
    "workspace.view",
    "access.view",
    "access.manage",
  ]);
  const card = await mount(<WorkspaceAccessCard />);
  await card.getByTestId("workspace-give-access").click();

  const dialog = page.getByTestId("give-access-dialog");
  await dialog.getByTestId("give-access-group").click();
  await page.getByRole("option", { name: "/sales" }).click();
  await dialog.getByTestId("give-access-role").click();
  // Viewer is picked to start with: swap it for Data reader alone.
  await page.getByRole("option", { name: "Viewer" }).click();
  await page.getByRole("option", { name: "Data reader" }).click();
  await page.keyboard.press("Escape");
  // A role given on single sources and tables asks which.
  await dialog.getByTestId("give-access-target").click();
  await page.getByRole("option", { name: "One source" }).click();
  await dialog.getByTestId("give-access-resource").click();
  await page.getByRole("option", { name: "Shop lake" }).click();
  await dialog.getByTestId("give-access-until").fill("2027-06-30");
  await dialog.getByTestId("give-access-submit").click();

  await expect
    .poll(() => calls.find((c) => c.method === "POST")?.body ?? "")
    .toContain('"scopeType":"source"');
  const body = JSON.parse(calls.find((c) => c.method === "POST")!.body!);
  expect(body).toMatchObject({
    subjectId: "sales",
    roleKey: "data-reader",
    resourceId: "s-shop",
  });
  expect(String(body.expiresAt)).toContain("2027-06-30");
});

test("hides changes from people who may only look", async ({ mount, page }) => {
  await mockAccess(page, ["workspace.view", "access.view", "source.manage"]);
  const card = await mount(<WorkspaceAccessCard />);

  // The group shows in the grants and again in the activity: any one will do.
  await expect(
    card.getByTestId("workspace-grants").getByText("/legal"),
  ).toBeVisible();
  await expect(card.getByRole("button", { name: "Remove access" })).toHaveCount(
    0,
  );
  await expect(card.getByRole("button", { name: "Give access" })).toHaveCount(
    0,
  );
});

test("what I can do is the same grouped table, with the grants that give me access", async ({
  mount,
  page,
}) => {
  await mockAccess(page, ["workspace.view", "access.view", "source.manage"]);
  const card = await mount(<WorkspaceAccessCard />);

  await expect(card.getByText("What I can do")).toBeVisible();
  // The mocked explain answers the same grant for each of the caller's
  // capabilities: it shows once, with what its role lets the caller do.
  const mine = card.getByTestId("what-i-can-do");
  await expect(mine.getByTestId("grants-group")).toHaveCount(1);
  await expect(mine.getByText("/legal")).toBeVisible();
  await expect(mine.getByText("finding.view")).toBeVisible();
  await expect(mine.getByRole("columnheader", { name: /Can do/ })).toBeVisible();
  // Read-only: nothing to remove here.
  await expect(mine.getByRole("button", { name: "Remove access" })).toHaveCount(0);
});

test("gives several roles at once, one grant each", async ({ mount, page }) => {
  const calls = await mockAccess(page, [
    "workspace.view",
    "access.view",
    "access.manage",
  ]);
  const card = await mount(<WorkspaceAccessCard />);
  await card.getByTestId("workspace-give-access").click();

  const dialog = page.getByTestId("give-access-dialog");
  await dialog.getByTestId("give-access-group").click();
  await page.getByRole("option", { name: "/sales" }).click();
  await dialog.getByTestId("give-access-role").click();
  await page.getByRole("option", { name: "Data reader" }).click();
  await page.keyboard.press("Escape");
  // Viewer and Data reader together: nothing hides the workspace, no warning.
  await expect(dialog.getByTestId("give-access-opens-nothing")).toHaveCount(0);
  await dialog.getByTestId("give-access-submit").click();

  await expect
    .poll(() => calls.filter((c) => c.method === "POST").length)
    .toBe(2);
  const roles = calls
    .filter((c) => c.method === "POST")
    .map((c) => JSON.parse(c.body!).roleKey)
    .sort();
  expect(roles).toEqual(["data-reader", "viewer"]);
});

test("says so when the roles picked do not open the workspace", async ({
  mount,
  page,
}) => {
  await mockAccess(page, ["workspace.view", "access.view", "access.manage"]);
  const card = await mount(<WorkspaceAccessCard />);
  await card.getByTestId("workspace-give-access").click();

  const dialog = page.getByTestId("give-access-dialog");
  await dialog.getByTestId("give-access-role").click();
  await page.getByRole("option", { name: "Viewer" }).click();
  await page.getByRole("option", { name: "Data reader" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog.getByTestId("give-access-opens-nothing")).toContainText(
    "Data reader",
  );
});

test("shows grants by group with the capabilities of each role, and warns about a group that cannot open the workspace", async ({
  mount,
  page,
}) => {
  await mockAccess(page, ["workspace.view", "access.view", "access.manage"]);
  await page.route("**/access/grants", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { ...grants[1], id: "g-v", subjectId: "legal", subjectLabel: "/legal" },
        {
          ...grants[1],
          id: "g-d1",
          subjectId: "data_access",
          subjectLabel: "/data_access",
          roleKey: "data-reader",
        },
      ]),
    }),
  );
  const card = await mount(<WorkspaceAccessCard />);

  const sections = card.getByTestId("workspace-grants").getByTestId("grants-group");
  await expect(sections).toHaveCount(2);
  const legal = sections.filter({ hasText: "/legal" });
  const data = sections.filter({ hasText: "/data_access" });
  await expect(legal.getByText("finding.view")).toBeVisible();
  await expect(legal.getByTestId("grants-cannot-open")).toHaveCount(0);
  await expect(data.getByText("data.query")).toBeVisible();
  await expect(data.getByTestId("grants-cannot-open")).toContainText(
    "Data reader",
  );
});
