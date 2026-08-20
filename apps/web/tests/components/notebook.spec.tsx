import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";
import { CellOutput } from "@/components/notebook/cell-output";
import { CodeCell } from "@/components/notebook/code-cell";
import { KeyValueField } from "@/components/key-value-field";
import { PackageTable } from "@/components/notebook/package-table";
import type { KeyValueEntry } from "@/lib/key-value";

// -- output sanitization -----------------------------------------------------
//
// Cell output is produced by code the notebook author wrote, but it is read by
// anyone who can open the source. These tests are the boundary.

test("html output renders a table but strips event handlers", async ({
  mount,
}) => {
  const component = await mount(
    <CellOutput
      output={{
        type: "display",
        data: {
          "text/html":
            '<table><tr><td onclick="alert(1)">cell</td></tr></table>' +
            '<img src=x onerror="alert(2)">',
          "text/plain": "fallback",
        },
      }}
    />,
  );

  await expect(component.getByTestId("output-html")).toContainText("cell");
  const html = await component.getByTestId("output-html").innerHTML();
  expect(html).toContain("<table");
  expect(html).not.toContain("onclick");
  expect(html).not.toContain("onerror");
  expect(html).not.toContain("<img");
});

test("html output cannot inject a script or an iframe", async ({ mount }) => {
  const component = await mount(
    <CellOutput
      output={{
        type: "display",
        data: {
          "text/html":
            '<div>ok</div><script>window.__pwned = true</script><iframe src="https://evil"></iframe>',
        },
      }}
    />,
  );

  const html = await component.getByTestId("output-html").innerHTML();
  expect(html).toContain("ok");
  expect(html).not.toContain("<script");
  expect(html).not.toContain("<iframe");
  expect(
    await component.evaluate(
      () => (window as never as Record<string, unknown>).__pwned,
    ),
  ).toBeUndefined();
});

test("html output cannot make the reader's browser navigate or fetch", async ({
  mount,
}) => {
  const component = await mount(
    <CellOutput
      output={{
        type: "display",
        data: { "text/html": '<a href="https://evil">click</a>' },
      }}
    />,
  );
  const html = await component.getByTestId("output-html").innerHTML();
  expect(html).toContain("click");
  expect(html).not.toContain("href");
});

test("svg output is sanitized", async ({ mount }) => {
  const component = await mount(
    <CellOutput
      output={{
        type: "display",
        data: {
          "image/svg+xml":
            '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/><script>alert(1)</script></svg>',
        },
      }}
    />,
  );
  const html = await component.getByTestId("output-svg").innerHTML();
  expect(html).toContain("circle");
  expect(html).not.toContain("<script");
});

test("png output renders from a data url", async ({ mount }) => {
  const pixel =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const component = await mount(
    <CellOutput output={{ type: "display", data: { "image/png": pixel } }} />,
  );
  await expect(component.getByTestId("output-png")).toHaveAttribute(
    "src",
    `data:image/png;base64,${pixel}`,
  );
});

test("an unknown mime type falls back to plain text rather than an empty box", async ({
  mount,
}) => {
  const component = await mount(
    <CellOutput
      output={{
        type: "display",
        data: {
          "application/vnd.custom+json": "{}",
          "text/plain": "readable fallback",
        },
      }}
    />,
  );
  await expect(component.getByTestId("output-plain")).toContainText(
    "readable fallback",
  );
});

test("stdout renders as its own stream", async ({ mount }) => {
  const component = await mount(
    <CellOutput output={{ type: "stream", name: "stdout", text: "hello" }} />,
  );
  await expect(component.getByTestId("output-stream-stdout")).toContainText(
    "hello",
  );
});

test("stderr renders as its own stream", async ({ mount }) => {
  const component = await mount(
    <CellOutput output={{ type: "stream", name: "stderr", text: "warning" }} />,
  );
  await expect(component.getByTestId("output-stream-stderr")).toContainText(
    "warning",
  );
});

// -- key sanitization --------------------------------------------------------

test("rejects keys the notebook could not read by name", async ({ mount }) => {
  let entries: KeyValueEntry[] = [{ key: "api-token", value: "v" }];
  const component = await mount(
    <KeyValueField
      entries={entries}
      onChange={(next) => {
        entries = next;
      }}
      label="Variables"
      addLabel="Add"
      testId="kv"
    />,
  );
  // A hyphen is not valid in a Python identifier, so ctx.var("api-token")
  // could never reach it.
  await expect(component.getByTestId("kv-key-0")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
});

test("accepts an underscored key", async ({ mount }) => {
  const component = await mount(
    <KeyValueField
      entries={[{ key: "api_base_url", value: "https://x" }]}
      onChange={() => undefined}
      label="Variables"
      addLabel="Add"
      testId="kv"
    />,
  );
  await expect(component.getByTestId("kv-key-0")).not.toHaveAttribute(
    "aria-invalid",
    "true",
  );
});

test("a stored secret shows as set without exposing its value", async ({
  mount,
}) => {
  const component = await mount(
    <KeyValueField
      entries={[{ key: "api_token", value: "", existing: true }]}
      onChange={() => undefined}
      secret
      label="Secrets"
      addLabel="Add"
      testId="kv"
    />,
  );
  const value = component.getByTestId("kv-value-0");
  await expect(value).toHaveAttribute("type", "password");
  await expect(value).toHaveValue("");
});

// -- Monaco loads from the bundle, not a CDN ---------------------------------

test("the code editor renders without reaching a CDN", async ({
  mount,
  page,
}) => {
  // The regression this guards: @monaco-editor/react fetches the editor from
  // cdn.jsdelivr.net unless loader.config() runs first. That fails silently in
  // the desktop app (static export, no internet assumption) and in air-gapped
  // clusters -- the editor just never appears.
  const cdnRequests: string[] = [];
  await page.route("**/cdn.jsdelivr.net/**", (route) => {
    cdnRequests.push(route.request().url());
    void route.abort();
  });

  const component = await mount(
    <CodeCell
      notebookId="nb-1"
      cellId="first"
      index={0}
      source={"def extract():\n    yield Asset(id='1')\n"}
      status="idle"
      outputs={[]}
      onChange={() => undefined}
      onRun={() => undefined}
      onDelete={() => undefined}
      onDuplicate={() => undefined}
      onSave={() => undefined}
    />,
  );

  // Monaco renders its content into .view-lines once it has actually loaded.
  await expect(component.locator(".monaco-editor").first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(component.getByText("def extract():")).toBeVisible();
  expect(cdnRequests).toEqual([]);
});

// -- packages ----------------------------------------------------------------

test("a package name that could reach an installer is rejected", async ({
  mount,
}) => {
  // The name is handed to uv's argv, so an argument-looking value must never
  // pass the form.
  const component = await mount(
    <PackageTable
      packages={[{ name: "--index-url", version: "" }]}
      onChange={() => undefined}
    />,
  );
  await expect(component.getByTestId("package-name-0")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
});

test("an ordinary package is accepted", async ({ mount }) => {
  const component = await mount(
    <PackageTable
      packages={[{ name: "google-cloud-storage", version: ">=2.0" }]}
      onChange={() => undefined}
    />,
  );
  await expect(component.getByTestId("package-name-0")).not.toHaveAttribute(
    "aria-invalid",
    "true",
  );
});

test("an empty version reads as latest rather than blank", async ({
  mount,
}) => {
  const component = await mount(
    <PackageTable packages={[{ name: "pandas" }]} onChange={() => undefined} />,
  );
  await expect(component.getByTestId("package-version-0")).toHaveAttribute(
    "placeholder",
    "latest",
  );
});
