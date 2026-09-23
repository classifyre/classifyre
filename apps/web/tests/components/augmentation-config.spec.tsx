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

test("enabling augmentation on an empty notebook shows template cards", async ({
  mount,
  page,
}) => {
  // The cards read the augmentation template library; the failing branch is
  // covered by the sibling test below.
  await page.route("**/notebooks/templates**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          name: "Starter notebook",
          description: "The minimum an augmentation needs.",
          cells: [
            {
              id: "augment",
              type: "code",
              source: "def augment(asset):\n    pass\n",
            },
          ],
        },
        {
          name: "Tag from what you already know",
          description: "Assert a fact as a tag.",
          cells: [
            {
              id: "tag",
              type: "code",
              source: "def augment(asset):\n    asset.tag('k', 'v')\n",
            },
          ],
        },
      ]),
    });
  });

  const component = await mount(
    <JsonSchemaForm
      schema={schemaWithAugmentation}
      defaultValues={{}}
      onSubmit={() => {}}
      showCancel={false}
    />,
  );

  await component.getByRole("button", { name: /augmentation/i }).click();
  await component.getByTestId("augmentation-enabled").click();

  // Source-creation style: one Starter card plus one per template, not the
  // Templates dropdown.
  await expect(
    component.getByTestId("augmentation-template-cards"),
  ).toBeVisible();
  await expect(
    component.getByTestId("augmentation-start-blank"),
  ).toBeVisible();
  await expect(
    component.getByTestId("augmentation-template-Starter notebook"),
  ).toBeVisible();
});

test("picking an augmentation template fills the notebook once", async ({
  mount,
  page,
}) => {
  await page.route("**/notebooks/templates**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          name: "Starter notebook",
          description: "The minimum an augmentation needs.",
          cells: [
            {
              id: "augment",
              type: "code",
              source: "def augment(asset):\n    pass\n",
            },
          ],
        },
      ]),
    });
  });

  const component = await mount(
    <JsonSchemaForm
      schema={schemaWithAugmentation}
      defaultValues={{}}
      onSubmit={() => {}}
      showCancel={false}
    />,
  );

  await component.getByRole("button", { name: /augmentation/i }).click();
  await component.getByTestId("augmentation-enabled").click();
  await component
    .getByTestId("augmentation-template-Starter notebook")
    .click();

  // The pick lands in the draft cells, and the cards step aside so they can
  // never replace work already on the page.
  await expect(component.getByTestId("notebook-cells")).toBeVisible();
  await expect(
    component.getByTestId("augmentation-template-cards"),
  ).toHaveCount(0);
});

test("augmentation template cards fall back to start-blank when loading fails", async ({
  mount,
  page,
}) => {
  await page.route("**/notebooks/templates**", async (route) => {
    await route.fulfill({ status: 500, body: "unavailable" });
  });

  const component = await mount(
    <JsonSchemaForm
      schema={schemaWithAugmentation}
      defaultValues={{}}
      onSubmit={() => {}}
      showCancel={false}
    />,
  );

  await component.getByRole("button", { name: /augmentation/i }).click();
  await component.getByTestId("augmentation-enabled").click();

  await expect(
    component.getByTestId("augmentation-start-blank"),
  ).toBeVisible();
  await expect(
    component.getByTestId("augmentation-template-cards"),
  ).toHaveCount(0);
});
