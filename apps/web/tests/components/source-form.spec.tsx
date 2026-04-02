import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";
import { SourceForm } from "@/components/source-form";

const validS3Defaults = {
  required: { bucket: "customer-exports" },
  masked: {
    aws_access_key_id: "access-key",
    aws_secret_access_key: "secret-key",
  },
  sampling: { strategy: "RANDOM" as const },
};

function getRequestTimeoutSeconds(
  payload: Record<string, unknown> | null,
): unknown {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const optional = payload.optional;
  if (!optional || typeof optional !== "object") {
    return undefined;
  }
  const connection = (optional as Record<string, unknown>).connection;
  if (!connection || typeof connection !== "object") {
    return undefined;
  }
  return (connection as Record<string, unknown>).request_timeout_seconds;
}

test("edit mode does not rehydrate optional numeric defaults from source schema", async ({
  mount,
}) => {
  let submitted: Record<string, unknown> | null = null;
  const component = await mount(
    <SourceForm
      sourceType="S3_COMPATIBLE_STORAGE"
      mode="edit"
      defaultValues={{ name: "existing-source", ...validS3Defaults }}
      onSubmit={(data) => {
        submitted = data;
      }}
      showCancel={false}
    />,
  );

  await component.getByRole("button", { name: /save changes/i }).click();

  expect(submitted).not.toBeNull();
  expect(getRequestTimeoutSeconds(submitted)).toBeUndefined();
});

test("create mode still shows source schema numeric defaults", async ({
  mount,
}) => {
  let submitted: Record<string, unknown> | null = null;
  const component = await mount(
    <SourceForm
      sourceType="S3_COMPATIBLE_STORAGE"
      mode="create"
      defaultValues={{ name: "new-source", ...validS3Defaults }}
      onSubmit={(data) => {
        submitted = data;
      }}
      showCancel={false}
    />,
  );

  await component.getByRole("button", { name: /create source/i }).click();

  expect(submitted).not.toBeNull();
  expect(getRequestTimeoutSeconds(submitted)).toBe(30);
});

test("jira source submits without optional scope filters", async ({
  mount,
}) => {
  let submitted: Record<string, unknown> | null = null;
  const component = await mount(
    <SourceForm
      sourceType="JIRA"
      mode="create"
      defaultValues={{
        name: "jira-source",
        required: {
          base_url: "https://classifyre.atlassian.net",
          account_email: "current_user@classifyre.de",
        },
        masked: { api_token: "token" },
        sampling: { strategy: "RANDOM" },
      }}
      onSubmit={(data) => {
        submitted = data;
      }}
      showCancel={false}
    />,
  );

  await component.getByRole("button", { name: /create source/i }).click();

  expect(submitted).not.toBeNull();
});

test("jira source submits when bounded scope is provided", async ({
  mount,
}) => {
  let submitted: Record<string, unknown> | null = null;
  const component = await mount(
    <SourceForm
      sourceType="JIRA"
      mode="create"
      defaultValues={{
        name: "jira-source",
        required: {
          base_url: "https://classifyre.atlassian.net",
          account_email: "current_user@classifyre.de",
        },
        masked: { api_token: "token" },
        optional: { scope: { project_keys: ["PLAT"] } },
        sampling: { strategy: "RANDOM" },
      }}
      onSubmit={(data) => {
        submitted = data;
      }}
      showCancel={false}
    />,
  );

  await component.getByRole("button", { name: /create source/i }).click();

  expect(submitted).not.toBeNull();
  if (!submitted) {
    throw new Error("Expected submitted payload");
  }
  const payload = submitted as unknown as Record<string, unknown>;
  const optional = payload["optional"] as Record<string, unknown> | undefined;
  const scope = optional?.["scope"] as Record<string, unknown> | undefined;
  expect(scope?.["project_keys"]).toEqual(["PLAT"]);
});

test("sampling checkbox submits fetch_all_until_first_success", async ({
  mount,
}) => {
  let submitted: Record<string, unknown> | null = null;
  const component = await mount(
    <SourceForm
      sourceType="POSTGRESQL"
      mode="create"
      defaultValues={{
        name: "new-source",
        required: {
          host: "db.local",
          port: 5432,
        },
        masked: {
          username: "postgres",
          password: "secret",
        },
        sampling: { strategy: "RANDOM" },
      }}
      onSubmit={(data) => {
        submitted = data;
      }}
      showCancel={false}
    />,
  );

  await component
    .getByRole("checkbox", { name: /fetch all until first success/i })
    .click();
  await component.getByRole("button", { name: /create source/i }).click();

  expect(submitted).not.toBeNull();
  if (!submitted) {
    throw new Error("Expected submitted payload");
  }
  const payload = submitted as unknown as Record<string, unknown>;
  const sampling = payload["sampling"] as Record<string, unknown> | undefined;
  expect(sampling?.["fetch_all_until_first_success"]).toBe(true);
});
