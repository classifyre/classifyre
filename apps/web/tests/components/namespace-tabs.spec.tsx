import { expect, test } from "@playwright/experimental-ct-react";
import {
  ActiveNamespacesFlowHarness,
  NamespaceTabsHarness,
} from "./fixtures/namespace-tabs-harness";

test("keeps the first namespace active after opening a second from the directory", async ({
  mount,
  page,
}) => {
  await page.evaluate(() => window.localStorage.clear());
  const component = await mount(<ActiveNamespacesFlowHarness />);

  await component.getByRole("button", { name: "Open Alpha" }).click();
  await expect(component.getByTestId("remembered-alpha")).toHaveText(
    "Alpha investigation:/alpha",
  );

  await component.getByRole("button", { name: "Back to workspaces" }).click();
  await component.getByRole("button", { name: "Open Beta" }).click();

  await expect(component.getByTestId("remembered-alpha")).toHaveText(
    "Alpha investigation:/alpha",
  );
  await expect(component.getByTestId("remembered-beta")).toHaveText(
    "Beta review:/beta",
  );

  await component.getByRole("button", { name: "Switch to Alpha" }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/alpha");
});

test("switches and closes namespace tabs", async ({ mount }) => {
  const component = await mount(<NamespaceTabsHarness />);

  await expect(
    component.getByRole("tab", { name: "Alpha investigation" }),
  ).toHaveAttribute("data-state", "active");

  await component.getByRole("tab", { name: "Beta review" }).click();
  await expect(component.getByTestId("active-workspace")).toHaveText("beta");

  await component
    .getByRole("button", { name: "Deactivate Beta review" })
    .click();
  await expect(component.getByTestId("active-workspace")).toHaveText("alpha");
  await expect(component.getByRole("tab", { name: "Beta review" })).toHaveCount(
    0,
  );
});

test("does not render a duplicate workspace-directory action", async ({
  mount,
}) => {
  const component = await mount(<NamespaceTabsHarness />);

  await expect(
    component.getByRole("button", { name: "Workspaces" }),
  ).toHaveCount(0);
  await expect(component.getByTestId("active-workspace")).toHaveText("alpha");
});
