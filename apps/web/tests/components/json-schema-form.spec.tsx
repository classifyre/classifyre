import * as React from "react";
import type { JSONSchema7 } from "json-schema";
import { expect, test } from "@playwright/experimental-ct-react";
import { JsonSchemaForm } from "@/components/json-schema-form";

const timeoutSchema: JSONSchema7 = {
  type: "object",
  properties: {
    request_timeout_seconds: {
      type: "number",
      default: 30,
      minimum: 1,
      description: "HTTP timeout in seconds",
    },
  },
};

test("optional number can be fully cleared without snapping back to template default", async ({
  mount,
}) => {
  const component = await mount(
    <JsonSchemaForm
      schema={timeoutSchema}
      defaultValues={{ request_timeout_seconds: 25 }}
      onSubmit={() => {}}
      showCancel={false}
    />,
  );

  const timeoutInput = component.getByRole("spinbutton", {
    name: /request timeout seconds/i,
  });

  await expect(timeoutInput).toHaveValue("25");
  await timeoutInput.press("Backspace");
  await expect(timeoutInput).toHaveValue("2");
  await timeoutInput.press("Backspace");
  await expect(timeoutInput).toHaveValue("");
  await timeoutInput.blur();
  await expect(timeoutInput).toHaveValue("");
});

test("schema defaults are applied in create mode", async ({ mount }) => {
  const component = await mount(
    <JsonSchemaForm
      schema={timeoutSchema}
      defaultValues={{}}
      onSubmit={() => {}}
      showCancel={false}
    />,
  );

  await component.getByRole("button", { name: /optional parameters/i }).click();
  await expect(
    component.getByRole("spinbutton", { name: /request timeout seconds/i }),
  ).toHaveValue("30");
});

test("schema defaults are not re-applied in edit mode when value is missing", async ({
  mount,
}) => {
  const component = await mount(
    <JsonSchemaForm
      schema={timeoutSchema}
      defaultValues={{}}
      includeSchemaDefaults={false}
      onSubmit={() => {}}
      showCancel={false}
    />,
  );

  await component.getByRole("button", { name: /optional parameters/i }).click();
  await expect(
    component.getByRole("spinbutton", { name: /request timeout seconds/i }),
  ).toHaveValue("");
});

test("custom forms can disable automatic sensitive masking heuristics", async ({
  mount,
}) => {
  const keySchema: JSONSchema7 = {
    type: "object",
    properties: {
      custom_detector_key: {
        type: "string",
      },
    },
    required: ["custom_detector_key"],
  };

  const component = await mount(
    <JsonSchemaForm
      schema={keySchema}
      defaultValues={{ custom_detector_key: "cust_invoice_rules" }}
      includeSchemaDefaults={false}
      autoDetectSensitiveFields={false}
      onSubmit={() => {}}
      showCancel={false}
    />,
  );

  const keyInput = component.getByRole("textbox", {
    name: /custom detector key/i,
  });
  await expect(keyInput).toHaveAttribute("type", "text");
  await expect(keyInput).toHaveValue("cust_invoice_rules");
});

test("oneOf selector switches branches when options share property names", async ({
  mount,
  page,
}) => {
  const mongoRequiredSchema: JSONSchema7 = {
    type: "object",
    properties: {
      required: {
        oneOf: [
          {
            title: "MongoDBRequiredAtlas",
            type: "object",
            properties: {
              deployment: { const: "ATLAS" },
              cluster_host: { type: "string" },
            },
            required: ["deployment", "cluster_host"],
            additionalProperties: false,
          },
          {
            title: "MongoDBRequiredOnPrem",
            type: "object",
            properties: {
              deployment: { const: "ON_PREM" },
              host: { type: "string", default: "localhost" },
              port: { type: "integer", default: 27017 },
            },
            required: ["deployment", "host", "port"],
            additionalProperties: false,
          },
        ],
      },
    },
    required: ["required"],
    additionalProperties: false,
  };

  const component = await mount(
    <JsonSchemaForm
      schema={mongoRequiredSchema}
      defaultValues={{}}
      onSubmit={() => {}}
      showCancel={false}
    />,
  );

  await expect(
    component.getByRole("textbox", { name: /cluster host/i }),
  ).toBeVisible();

  await component.getByRole("combobox").click();
  await page.getByRole("option", { name: "MongoDBRequiredOnPrem" }).click();

  await expect(
    component.getByRole("textbox", { name: /^host \*$/i }),
  ).toBeVisible();
  await expect(
    component.getByRole("textbox", { name: /^host \*$/i }),
  ).toHaveValue("localhost");
  await expect(
    component.getByRole("spinbutton", { name: /^port \*$/i }),
  ).toHaveValue("27017");
  await expect(
    component.getByRole("textbox", { name: /cluster host/i }),
  ).toHaveCount(0);

  await component.getByRole("combobox").click();
  await page.getByRole("option", { name: "MongoDBRequiredAtlas" }).click();

  await expect(
    component.getByRole("textbox", { name: /cluster host/i }),
  ).toBeVisible();
  await expect(
    component.getByRole("textbox", { name: /^host \*$/i }),
  ).toHaveCount(0);
});

test("free-form object fields render a JSON editor", async ({ mount }) => {
  const hiveSchema: JSONSchema7 = {
    type: "object",
    properties: {
      connect_args: {
        type: "object",
        description:
          "Additional PyHive connection arguments (e.g. auth, kerberos_service_name, http_path).",
        default: {},
        additionalProperties: true,
      },
    },
  };

  const component = await mount(
    <JsonSchemaForm
      schema={hiveSchema}
      defaultValues={{}}
      onSubmit={() => {}}
      showCancel={false}
    />,
  );

  await component.getByRole("button", { name: /optional parameters/i }).click();
  await expect(component.getByTestId("connect_args-json-editor")).toBeVisible();
  await expect(
    component.getByText(/no configurable fields available/i),
  ).toHaveCount(0);
});
