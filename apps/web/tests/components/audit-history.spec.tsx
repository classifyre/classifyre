import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";
import { AuditEventList, ChangedBy } from "@/components/audit-history";
import { signedInAs } from "./fixtures/signed-in";

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

function paged(bodyEvents: typeof events, total: number) {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      items: bodyEvents,
      total,
      skip: 0,
      limit: 50,
    }),
  };
}

async function mockAuditApi(page: CtPage) {
  const resolved: string[][] = [];
  await page.route("**/instance-settings", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        language: "ENGLISH",
        timezone: "UTC",
        timeFormat: "TWELVE_HOUR",
        mcpEnabled: false,
      }),
    }),
  );
  await page.route("**/*audit-events*", async (route) => {
    const url = new URL(route.request().url());
    const limit = Number(url.searchParams.get("limit"));
    const skip = Number(url.searchParams.get("skip") ?? 0);
    const search = url.searchParams.get("search")?.toLowerCase() ?? "";
    const filtered = search
      ? events.filter((event) =>
          `${event.operation} ${event.capability} ${event.entityType} ${event.actor}`
            .toLowerCase()
            .includes(search),
        )
      : events;
    await route.fulfill(paged(filtered.slice(skip, skip + (limit || filtered.length)), filtered.length));
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
  await signedInAs(page, ["workspace.view", "activity.view"]);
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

test("the history sheet lists every change in a dense table", async ({
  mount,
  page,
}) => {
  await signedInAs(page, ["workspace.view", "activity.view"]);
  await mockAuditApi(page);
  const component = await mount(
    <ChangedBy entityType="sources" entityId="s1" />,
  );
  await component.getByRole("button", { name: "History" }).click();

  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("MCP · update_source")).toBeVisible({ timeout: 15000 });
  await expect(sheet.getByText("MCP · update_source")).toBeVisible();
  await expect(sheet.getByText("config, name")).toBeVisible();
  await expect(sheet.getByText("POST /sources")).toBeVisible();
  await expect(sheet.getByText("name, type")).toBeVisible();
});

test("without activity.view (a visitor) there is no history to open", async ({
  mount,
  page,
}) => {
  await signedInAs(page, ["workspace.view", "source.view"]);
  const requests: string[] = [];
  await page.route("**/audit-events**", (route) => {
    requests.push(route.request().url());
    return route.fulfill({ status: 403, body: "{}" });
  });
  const component = await mount(
    <ChangedBy entityType="sources" entityId="s1" createdBy="Jordan Reyes" />,
  );
  await expect(component.getByText("Created by")).toBeVisible();
  await expect(component.getByRole("button", { name: "History" })).toHaveCount(0);
  // The trail is never asked for: who did what is not the public's.
  expect(requests).toEqual([]);
});

test("the activity table filters server-side", async ({ mount, page }) => {
  await mockAuditApi(page);
  const component = await mount(<AuditEventList filter={{}} showEntity />);

  await expect(component.getByText("POST /sources")).toBeVisible({ timeout: 15000 });
  await component.getByPlaceholder("Filter activity…").fill("update_source");
  await expect(component.getByText("POST /sources")).toHaveCount(0);
  await expect(component.getByText("MCP · update_source")).toBeVisible();
});

test("an empty trail says so", async ({ mount, page }) => {
  await page.route("**/*audit-events*", (route) =>
    route.fulfill(paged([], 0)),
  );
  const component = await mount(<AuditEventList filter={{}} />);
  await expect(component.getByText("No changes recorded yet.")).toBeVisible({ timeout: 15000 });
});
