import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";
import { PlatformAdmin } from "@/components/platform/platform-admin";

const tenants = [
  {
    id: "t-acme",
    alias: "acme",
    name: "Acme",
    status: "active",
    createdAt: "2026-11-01T10:00:00.000Z",
    workspaces: 0,
    members: 3,
    admins: [{ id: "u-ada", name: "Ada Kowalczyk", email: "ada@example.test" }],
    lastActivityAt: null,
    problem: null,
  },
  {
    id: "t-globex",
    alias: "globex",
    name: "Globex",
    status: "suspended",
    createdAt: "2026-11-01T10:00:00.000Z",
    workspaces: 2,
    members: 5,
    admins: [],
    lastActivityAt: null,
    problem: "NO_ADMINS_GROUP",
  },
];

test.beforeEach(async ({ page }) => {
  const json = (body: unknown) => ({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
  await page.route("**/platform/me", (route) =>
    route.fulfill(json({ operator: true, name: "Ola Operator" })),
  );
  await page.route("**/platform/tenants", (route) => route.fulfill(json(tenants)));
  await page.route("**/platform/workspaces/local", (route) =>
    route.fulfill(json([{ id: "w1", slug: "finance-ledger", name: "Finance ledger" }])),
  );
});

test("lists tenants with their status, problems and admins", async ({ mount }) => {
  const page = await mount(<PlatformAdmin />);
  await expect(page.getByText("Admins: Ada Kowalczyk")).toBeVisible();
  await expect(page.getByText("suspended", { exact: true })).toBeVisible();
  await expect(page.getByText("no admins group")).toBeVisible();
  await expect(page.getByText("Workspaces made without sign-in: 1.", { exact: false })).toBeVisible();
});

test("suggests an alias from the name", async ({ mount }) => {
  const page = await mount(<PlatformAdmin />);
  await page.getByRole("button", { name: "New tenant" }).click();
  await page.page().getByLabel("Name", { exact: true }).fill("Initech Holdings");
  await expect(page.page().getByLabel("Alias")).toHaveValue("initech-holdings");
});

test("deletes only after the alias is typed", async ({ mount }) => {
  const page = await mount(<PlatformAdmin />);
  await page.getByRole("button", { name: "Actions for Acme" }).click();
  await page.page().getByRole("menuitem", { name: "Delete tenant" }).click();
  const dialog = page.page().getByRole("alertdialog");
  const confirm = dialog.getByRole("button", { name: "Delete tenant" });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Type acme to confirm").fill("acme");
  await expect(confirm).toBeEnabled();
});
