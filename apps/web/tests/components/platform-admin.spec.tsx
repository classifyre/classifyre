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
    database: "classifyre_t_acme",
    upgradeError: null,
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
    database: null,
    upgradeError: null,
    problem: "NO_ADMINS_GROUP",
  },
  {
    id: "t-initech",
    alias: "initech",
    name: "Initech",
    status: "active",
    createdAt: "2026-11-01T10:00:00.000Z",
    workspaces: 1,
    members: 1,
    admins: [{ id: "u-bill", name: "Bill Persona", email: "bill@example.test" }],
    lastActivityAt: null,
    database: "classifyre_t_initech",
    upgradeError: 'relation "sources" does not exist',
    problem: "UPGRADE_FAILED",
  },
  {
    id: "t-hooli",
    alias: "hooli",
    name: "Hooli",
    status: "active",
    createdAt: "2026-11-01T10:00:00.000Z",
    workspaces: 1,
    members: 0,
    admins: [],
    lastActivityAt: null,
    database: "classifyre_t_hooli",
    upgradeError: null,
    problem: "ORGANIZATION_MISSING",
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

test("shows each tenant's database and a failed upgrade", async ({ mount }) => {
  const page = await mount(<PlatformAdmin />);
  await expect(page.getByText("classifyre_t_acme")).toBeVisible();
  await expect(page.getByText("upgrade failed", { exact: true })).toBeVisible();
  await expect(page.getByText('relation "sources" does not exist', { exact: false })).toBeVisible();
});

test("offers only removal for a tenant whose organization was deleted", async ({ mount }) => {
  const page = await mount(<PlatformAdmin />);
  await page.getByRole("button", { name: "Actions for Hooli" }).click();
  const menu = page.page().getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveCount(1);
  await menu.getByRole("menuitem", { name: "Remove tenant data" }).click();
  const dialog = page.page().getByRole("alertdialog");
  const confirm = dialog.getByRole("button", { name: "Remove tenant data" });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Type hooli to confirm").fill("hooli");
  await expect(confirm).toBeEnabled();
});

test("does not create tenants or change admins here", async ({ mount }) => {
  const page = await mount(<PlatformAdmin />);
  await expect(page.getByRole("button", { name: "New tenant" })).toHaveCount(0);
  await page.getByRole("button", { name: "Actions for Acme" }).click();
  await expect(page.page().getByRole("menuitem", { name: "Admins" })).toHaveCount(0);
  await expect(page.page().getByRole("menuitem", { name: "Remove tenant data" })).toHaveCount(0);
});
