import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";

test("mount smoke", async ({ mount }) => {
  const component = await mount(<div data-testid="smoke">ok</div>);
  await expect(component).toContainText("ok");
});
