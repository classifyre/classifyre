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

test("optional parameters are expanded on mount", async ({ mount }) => {
  const component = await mount(
    <JsonSchemaForm
      schema={timeoutSchema}
      defaultValues={{}}
      onSubmit={() => {}}
      showCancel={false}
    />,
  );

  // The optional block holds the settings that shape a scan, so it must not be
  // hidden behind a click the user never makes.
  await expect(
    component.getByRole("spinbutton", { name: /request timeout seconds/i }),
  ).toBeVisible();
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

  await expect(component.getByTestId("connect_args-json-editor")).toBeVisible();
  await expect(
    component.getByText(/no configurable fields available/i),
  ).toHaveCount(0);
});

test("service-account JSON renders as a masked textarea, not a cleartext input", async ({
  mount,
}) => {
  const gcsSchema: JSONSchema7 = {
    type: "object",
    properties: {
      masked: {
        type: "object",
        properties: {
          gcp_credentials_json: {
            type: "string",
            description: "Google service account credentials JSON as inline string",
          },
        },
      },
    },
  };

  const component = await mount(
    <JsonSchemaForm
      schema={gcsSchema}
      defaultValues={{}}
      onSubmit={() => {}}
      showCancel={false}
    />,
  );

  // A whole JSON key cannot live in a single-line input, and it must not be
  // readable on screen either.
  const field = component.getByTestId("input-masked-gcp-credentials-json");
  await expect(field).toBeVisible();
  await expect(field).toHaveAttribute("data-masked", "true");
  expect(await field.evaluate((node) => node.tagName)).toBe("TEXTAREA");
});

test("an empty credentials block is not rendered at all", async ({ mount }) => {
  const noAuthSchema: JSONSchema7 = {
    type: "object",
    properties: {
      required: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute path" },
        },
        required: ["path"],
      },
      // LOCAL_FOLDER and SQLITE declare masked with nothing in it.
      masked: { type: "object", properties: {} },
    },
  };

  const component = await mount(
    <JsonSchemaForm
      schema={noAuthSchema}
      defaultValues={{}}
      onSubmit={() => {}}
      showCancel={false}
    />,
  );

  await expect(component.getByRole("textbox", { name: /path/i })).toBeVisible();
  await expect(component.getByText(/^Authentication$/)).toHaveCount(0);
});
