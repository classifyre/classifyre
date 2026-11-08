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
    calls.push({ method: request.method(), url: request.url(), body: request.postData() ?? undefined });
    await route.fulfill(json(request.method() === "POST" ? grants[1] : grants));
  });
  await page.route("**/access/grants/*", async (route) => {
    calls.push({ method: route.request().method(), url: route.request().url() });
    await route.fulfill({ status: 204, body: "" });
  });
  await page.route("**/access/roles", (route) =>
    route.fulfill(
      json([
        { key: "viewer", title: "Viewer", scopes: ["workspace", "group", "tenant"], capabilities: [] },
        { key: "tenant-admin", title: "Tenant admin", scopes: ["tenant"], capabilities: [] },
      ]),
    ),
  );
  await page.route("**/access/groups", (route) =>
    route.fulfill(
      json([{ id: "sales", name: "sales", path: "/sales", parentId: null }]),
    ),
  );
  await page.route("**/access/explain?*", (route) =>
    route.fulfill(json([grants[1]])),
  );
  await page.route("**/me", (route) =>
    route.fulfill(
      json({
        actor: { id: "user:u1", displayName: "Ada Kowalczyk", kind: "person", via: "oidc" },
        iamEnabled: true,
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
  const calls = await mockAccess(page, ["workspace.view", "access.view", "access.manage"]);
  const card = await mount(<WorkspaceAccessCard />);

  await expect(card.getByText("/admins")).toBeVisible();
  await expect(card.getByText("Inherited", { exact: true })).toHaveCount(1);
  const remove = card.getByRole("button", { name: "Remove access" });
  await expect(remove).toHaveCount(1);

  await remove.click();
  await expect.poll(() => calls.some((c) => c.method === "DELETE" && c.url.endsWith("/access/grants/g-legal"))).toBe(true);
});

test("gives a group a role from the form", async ({ mount, page }) => {
  const calls = await mockAccess(page, ["workspace.view", "access.view", "access.manage"]);
  const card = await mount(<WorkspaceAccessCard />);

  // The groups arrive with the grants: open the picker only once they are in.
  await expect(card.getByText("/legal")).toBeVisible();
  await card.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "/sales" }).click();
  await card.getByRole("button", { name: "Give access" }).click();

  await expect
    .poll(() => calls.find((c) => c.method === "POST")?.body ?? "")
    .toContain('"subjectId":"sales"');
});

test("hides changes from people who may only look", async ({ mount, page }) => {
  await mockAccess(page, ["workspace.view", "access.view"]);
  const card = await mount(<WorkspaceAccessCard />);

  await expect(card.getByText("/legal")).toBeVisible();
  await expect(card.getByRole("button", { name: "Remove access" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Give access" })).toHaveCount(0);
});
