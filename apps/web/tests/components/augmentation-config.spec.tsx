import * as React from "react";
import type { JSONSchema7 } from "json-schema";
import { expect, test } from "@playwright/experimental-ct-react";
import { JsonSchemaForm } from "@/components/json-schema-form";

// Mirrors the real shape: every *Input schema carries a top-level
// `augmentation` property, which the form lifts out of "Optional Parameters"
// into its own accordion.
const schemaWithAugmentation: JSONSchema7 = {
  type: "object",
  properties: {
    type: { const: "POSTGRESQL" },
    required: {
      type: "object",
      properties: {
        host: { type: "string", description: "Database host" },
      },
    },
    augmentation: {
      type: "object",
      description: "Optional per-asset enrichment notebook",
      properties: {
        enabled: { type: "boolean", default: false },
      },
    },
  },
};

test("augmentation renders as a collapsed accordion, not a JSON card", async ({
  mount,
}) => {
  const component = await mount(
    <JsonSchemaForm
      schema={schemaWithAugmentation}
      defaultValues={{}}
      onSubmit={() => {}}
      showCancel={false}
    />,
  );

  // A proper home with a title, not the untitled JSON card unknown blocks
  // fall into.
  const trigger = component.getByRole("button", { name: /augmentation/i });
  await expect(trigger).toBeVisible();

  // Collapsed by default: the editor and its switch stay unmounted until the
  // author asks for them.
  await expect(
    component.getByTestId("augmentation-enabled"),
  ).toHaveCount(0);
});

test("expanding augmentation shows the enable switch and editor mounts on toggle", async ({
  mount,
}) => {
  const component = await mount(
    <JsonSchemaForm
      schema={schemaWithAugmentation}
      defaultValues={{}}
      onSubmit={() => {}}
      showCancel={false}
    />,
  );

  await component.getByRole("button", { name: /augmentation/i }).click();
  const enableSwitch = component.getByTestId("augmentation-enabled");
  await expect(enableSwitch).toBeVisible();

  await enableSwitch.click();
  // The editor area mounts: without a sourceId it offers draft cells plus a
  // note that runs need a saved source.
  await expect(component.getByTestId("augmentation-config")).toBeVisible();
  await expect(component.getByTestId("notebook-cells")).toBeVisible();
});

test("toggling augmentation writes the form value", async ({ mount }) => {
  let submitted: Record<string, unknown> | null = null;
  const component = await mount(
    <JsonSchemaForm
      schema={schemaWithAugmentation}
      defaultValues={{}}
      onSubmit={(data) => {
        submitted = data;
      }}
    />,
  );

  await component.getByRole("button", { name: /augmentation/i }).click();
  await component.getByTestId("augmentation-enabled").click();

  // Submit surfaces the augmentation block as a value, not dropped.
  await component.getByTestId("btn-save-source").click();
  await expect
    .poll(() => (submitted as Record<string, unknown> | null)?.augmentation)
    .toBeDefined();
});
