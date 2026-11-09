import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";
import { AuditEventList, ChangedBy } from "@/components/audit-history";

type CtPage = Parameters<Parameters<typeof test>[2]>[0]["page"];

const TOKEN = "mcp:2c7b9260-cc88-45f8-9459-defe4a662708";

const events = [
  {
    id: "e2",
    occurredAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    actor: TOKEN,
    via: "mcp-token",
    channel: "mcp",
    capability: "source.manage",
    operation: "update_source",
    entityType: "sources",
    entityId: "s1",
    fields: ["config", "name"],
    status: null,
  },
  {
    id: "e1",
    occurredAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    actor: "Jordan Reyes",
    via: "header",
    channel: "rest",
    capability: "source.manage",
    operation: "POST /sources",
    entityType: "sources",
    entityId: "s1",
    fields: ["name", "type"],
    status: 201,
  },
];

async function mockAuditApi(page: CtPage) {
  const resolved: string[][] = [];
  await page.route("**/audit-events?*", async (route) => {
    const limit = Number(new URL(route.request().url()).searchParams.get("limit"));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(events.slice(0, limit || events.length)),
    });
  });
  await page.route("**/actors/resolve?*", async (route) => {
    const refs = new URL(route.request().url()).searchParams.getAll("refs");
    resolved.push(refs);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        refs.map((ref) => ({
          ref,
          kind: "mcp",
          displayName: "claude-desktop",
        })),
      ),
    });
  });
  return { resolved };
}

test("ChangedBy names the creator and the last change, resolving the token", async ({
  mount,
  page,
}) => {
  const { resolved } = await mockAuditApi(page);
  const component = await mount(
    <ChangedBy entityType="sources" entityId="s1" createdBy="Jordan Reyes" />,
  );

  await expect(component.getByText("Created by")).toBeVisible();
  await expect(component.getByText("Jordan Reyes")).toBeVisible();
  await expect(component.getByText("Last changed by")).toBeVisible();
  // The token reference is never shown raw: it resolves to the token's name.
  await expect(component.getByText("claude-desktop")).toBeVisible();
  await expect(component.getByText(TOKEN)).toHaveCount(0);
  // Self-declared names need no request; only the token is resolved.
  expect(resolved.flat()).toEqual([TOKEN]);
});

test("the history sheet lists every change with field names only", async ({
  mount,
  page,
}) => {
  await mockAuditApi(page);
  const component = await mount(
    <ChangedBy entityType="sources" entityId="s1" />,
  );
  await component.getByRole("button", { name: "History" }).click();

  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("MCP · update_source")).toBeVisible();
  await expect(sheet.getByText("Fields: config, name")).toBeVisible();
  await expect(sheet.getByText("POST /sources")).toBeVisible();
  await expect(sheet.getByText("Fields: name, type")).toBeVisible();
});

test("an empty trail says so", async ({ mount, page }) => {
  await page.route("**/audit-events?*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  const component = await mount(<AuditEventList filter={{}} />);
  await expect(component.getByText("No changes recorded yet.")).toBeVisible();
});
