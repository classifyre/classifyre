import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";
import { ScheduleCardHarness } from "./fixtures/schedule-card-harness";

/**
 * The card has three states and the cron controls belong to exactly one of
 * them. Regression guard: they used to be hidden only for AUTO, so a new
 * source — which starts with the schedule off — landed on a bare cron grid
 * with no way to see the Automatic/Fixed choice.
 */

test("a new source lands on the mode selector with Automatic chosen", async ({
  mount,
}) => {
  const component = await mount(<ScheduleCardHarness />);

  await expect(
    component.getByRole("button", { name: /Automatic/ }),
  ).toBeVisible();
  await expect(
    component.getByRole("button", { name: /Fixed schedule/ }),
  ).toBeVisible();

  await expect(component.getByPlaceholder("e.g. 30 6 * * 1-5")).toBeHidden();
  await expect(component.getByText("Frequency")).toBeHidden();
});

test("choosing Fixed reveals the presets and the cron input", async ({
  mount,
}) => {
  const component = await mount(<ScheduleCardHarness />);

  await component.getByRole("button", { name: /Fixed schedule/ }).click();

  await expect(component.getByText("Frequency")).toBeVisible();
  await expect(component.getByPlaceholder("e.g. 30 6 * * 1-5")).toBeVisible();
  await expect(
    component.getByRole("button", { name: /Nightly/ }),
  ).toBeVisible();
});

test("switching the schedule off hides both the modes and the cron controls", async ({
  mount,
}) => {
  const component = await mount(<ScheduleCardHarness />);

  await component.getByRole("switch").click();

  await expect(
    component.getByRole("button", { name: /Automatic/ }),
  ).toBeHidden();
  await expect(component.getByText("Frequency")).toBeHidden();
  await expect(component.getByPlaceholder("e.g. 30 6 * * 1-5")).toBeHidden();
  await expect(
    component.getByText("Toggle on to enable automated ingestion"),
  ).toBeVisible();
});
