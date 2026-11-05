import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";
import { TenantPeople } from "@/components/access/tenant-people";

const groups = [
  { id: "g-admins", name: "admins", path: "/admins", parentId: null },
  { id: "g-fin", name: "finance", path: "/finance", parentId: null },
];

const people = [
  {
    id: "u-me",
    username: "ada@example.test",
    email: "ada@example.test",
    firstName: "Ada",
    lastName: "Kowalczyk",
    enabled: true,
    fromDirectory: false,
    createdHere: false,
    groupIds: ["g-admins"],
    isYou: true,
  },
  {
    id: "u-bo",
    username: "bo@example.test",
    email: "bo@example.test",
    firstName: "Bo",
    lastName: "Lind",
    enabled: true,
    fromDirectory: false,
    createdHere: true,
    groupIds: [],
    isYou: false,
  },
];

test("lists people with their groups, and nobody can remove themselves", async ({ mount }) => {
  const card = await mount(
    <TenantPeople people={people} groups={groups} editable onChanged={async () => {}} />,
  );
  await expect(card.getByText("Ada Kowalczyk")).toBeVisible();
  await expect(card.getByText("/admins")).toBeVisible();
  await expect(card.getByText("In no group")).toBeVisible();
  await expect(card.getByRole("button", { name: "Actions for Bo Lind" })).toBeVisible();

  await card.getByRole("button", { name: "Actions for Ada Kowalczyk" }).click();
  await expect(card.page().getByRole("menuitem", { name: "Change groups" })).toBeVisible();
  await expect(card.page().getByRole("menuitem", { name: "Remove from tenant" })).toHaveCount(0);
});

test("adds a person and shows their temporary password once", async ({ mount, page }) => {
  let posted = "";
  await page.route("**/tenant/people", async (route) => {
    posted = route.request().postData() ?? "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ person: people[1], temporaryPassword: "Temp-pass-123456789x" }),
    });
  });
  const card = await mount(
    <TenantPeople people={people} groups={groups} editable onChanged={async () => {}} />,
  );

  await card.getByRole("button", { name: "Add person" }).click();
  await page.getByLabel("Email").fill("bo@example.test");
  await page.getByLabel("First name").fill("Bo");
  await page.getByLabel("Last name").fill("Lind");
  await page.getByRole("dialog").getByRole("button", { name: "Add person" }).click();

  await expect.poll(() => posted).toContain('"email":"bo@example.test"');
  await expect(page.getByRole("textbox", { name: "Temporary password" })).toHaveValue(
    "Temp-pass-123456789x",
  );
});

test("shows people read-only when a directory owns them", async ({ mount }) => {
  const card = await mount(
    <TenantPeople people={people} groups={groups} editable={false} onChanged={async () => {}} />,
  );
  await expect(card.getByText("Bo Lind")).toBeVisible();
  await expect(card.getByRole("button", { name: "Add person" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: /Actions for/ })).toHaveCount(0);
});
