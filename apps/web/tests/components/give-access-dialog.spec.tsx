import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";
import { TenantGiveAccessHarness } from "./fixtures/tenant-give-access-harness";

type CtPage = Parameters<Parameters<typeof test>[2]>[0]["page"];

async function mockTenantGrants(page: CtPage) {
  const posted: Array<Record<string, unknown>> = [];
  await page.route("**/tenant/grants", (route) => {
    posted.push(route.request().postDataJSON());
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "g-new" }),
    });
  });
  return posted;
}

test("the tenant dialog gives several roles on the whole tenant, one grant each", async ({
  mount,
  page,
}) => {
  const posted = await mockTenantGrants(page);
  await mount(<TenantGiveAccessHarness />);
  const dialog = page.getByTestId("give-access-dialog");

  await dialog.getByTestId("give-access-group").click();
  await page.getByRole("option", { name: "/sales" }).click();
  await dialog.getByTestId("give-access-role").click();
  await page.getByRole("option", { name: "Data reader" }).click();
  await page.keyboard.press("Escape");
  // The tenant page asks which group's workspaces first; here: the whole tenant.
  await dialog.getByTestId("give-access-target").click();
  await page.getByRole("option", { name: "The whole tenant" }).click();
  await dialog.getByTestId("give-access-until").fill("2027-06-30");
  await dialog.getByTestId("give-access-submit").click();

  await expect.poll(() => posted.length).toBe(2);
  expect(posted.map((body) => body.roleKey).sort()).toEqual(["data-reader", "viewer"]);
  for (const body of posted) {
    expect(body).toMatchObject({
      subjectId: "sales",
      scopeType: "tenant",
      scopeId: "t1",
    });
    expect(String(body.expiresAt)).toContain("2027-06-30");
  }
});

test("the tenant dialog picks a workspace, and a tenant-only role leaves only the tenant", async ({
  mount,
  page,
}) => {
  const posted = await mockTenantGrants(page);
  await mount(<TenantGiveAccessHarness />);
  const dialog = page.getByTestId("give-access-dialog");

  await dialog.getByTestId("give-access-group").click();
  await page.getByRole("option", { name: "/sales" }).click();
  await dialog.getByTestId("give-access-target").click();
  await page.getByRole("option", { name: "One workspace" }).click();
  await dialog.getByTestId("give-access-resource").click();
  await page.getByRole("option", { name: "Shop" }).click();
  await dialog.getByTestId("give-access-submit").click();
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]).toMatchObject({
    roleKey: "viewer",
    scopeType: "workspace",
    scopeId: "ws-1",
  });

  // Tenant admin can only be given on the tenant: the choice narrows to it.
  await dialog.getByTestId("give-access-role").click();
  await page.getByRole("option", { name: "Tenant admin" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog.getByTestId("give-access-target")).toBeDisabled();
  await expect(dialog.getByTestId("give-access-target")).toContainText("The whole tenant");
});
