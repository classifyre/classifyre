import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";
import { AssistantPanelHarness } from "./fixtures/assistant-panel-harness";

/**
 * The composer's "@" menu and the thread switcher.
 *
 * These are the two things that make the assistant usable for writing a custom
 * connector: pointing at a specific cell without describing it, and keeping
 * "write extract()" apart from "why does the token fail".
 */

const mentions = [
  {
    token: "@cell:1",
    label: "Cell 1 — from classifyre import Asset, ctx",
    group: "cell",
    body: "cell one body",
  },
  {
    token: "@cell:extract",
    label: "extract — def extract():",
    group: "cell",
    body: "cell two body",
  },
  {
    token: "@file:dump.csv",
    label: "dump.csv",
    group: "file",
    body: "file body",
  },
  {
    token: "@detector:PII",
    label: "PII Detector",
    group: "detector",
    body: "detector body",
  },
];

test("typing @ offers every reference and narrows as you type", async ({
  mount,
}) => {
  const component = await mount(<AssistantPanelHarness mentions={mentions} />);
  const input = component.getByTestId("assistant-input");

  await input.click();
  await input.pressSequentially("rewrite @");
  await expect(component.getByTestId("assistant-mention-menu")).toBeVisible();
  await expect(
    component.getByTestId("assistant-mention-@detector:PII"),
  ).toBeVisible();

  await input.pressSequentially("cell:e");
  await expect(
    component.getByTestId("assistant-mention-@cell:extract"),
  ).toBeVisible();
  await expect(
    component.getByTestId("assistant-mention-@detector:PII"),
  ).toHaveCount(0);
});

test("choosing a reference completes the token in the message", async ({
  mount,
}) => {
  const component = await mount(<AssistantPanelHarness mentions={mentions} />);
  const input = component.getByTestId("assistant-input");

  await input.click();
  await input.pressSequentially("rewrite @cell:ex");
  await component.getByTestId("assistant-mention-@cell:extract").click();

  await expect(component.getByTestId("panel-input-value")).toHaveText(
    "rewrite @cell:extract ",
  );
  await expect(component.getByTestId("assistant-mention-menu")).toHaveCount(0);
});

test("an @ in the middle of a word is not a reference", async ({ mount }) => {
  const component = await mount(<AssistantPanelHarness mentions={mentions} />);
  const input = component.getByTestId("assistant-input");

  await input.click();
  await input.pressSequentially("mail me@example");
  await expect(component.getByTestId("assistant-mention-menu")).toHaveCount(0);
});

test("Enter sends when no reference menu is open", async ({ mount }) => {
  const component = await mount(<AssistantPanelHarness mentions={mentions} />);
  const input = component.getByTestId("assistant-input");

  await input.click();
  await input.pressSequentially("write the connector");
  await input.press("Enter");

  await expect(component.getByTestId("sent-count")).toHaveText("1");
});

test("a new chat starts empty and the old one is still reachable", async ({
  mount,
}) => {
  const component = await mount(<AssistantPanelHarness mentions={mentions} />);

  await expect(component.getByTestId("assistant-threads-toggle")).toHaveCount(
    0,
  );

  await component.getByTestId("assistant-new-thread").click();
  await component.getByTestId("assistant-threads-toggle").click();
  await expect(component.getByTestId("assistant-thread-list")).toBeVisible();

  await component.getByTestId("assistant-thread-first").click();
  await expect(component.getByTestId("active-thread")).toHaveText("first");
});
