import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";
import { CellListHarness } from "./fixtures/cell-list-harness";
import type { NotebookCell } from "@/lib/notebook-cells";

const scaffold = (): NotebookCell[] => [
  { id: "intro", type: "markdown", source: "# Custom connector" },
  { id: "imports", type: "code", source: "from classifyre import Asset, ctx" },
  {
    id: "test-connection",
    type: "code",
    source: "def test_connection():\n    return {}",
  },
  {
    id: "extract",
    type: "code",
    source: "def extract():\n    yield Asset(id='1')",
  },
];

test("a cell that carries a required function cannot be deleted", async ({
  mount,
}) => {
  const component = await mount(<CellListHarness initialCells={scaffold()} />);
  await expect(component.getByTestId("delete-cell-extract")).toBeDisabled();
  await expect(
    component.getByTestId("delete-cell-test-connection"),
  ).toBeDisabled();
});

test("ordinary cells stay deletable", async ({ mount }) => {
  const component = await mount(<CellListHarness initialCells={scaffold()} />);
  await expect(component.getByTestId("delete-cell-imports")).toBeEnabled();

  await component.getByTestId("delete-cell-imports").click();
  await expect(component.getByTestId("cell-ids")).toHaveText(
    "intro,test-connection,extract",
  );
});

test("code and markdown cells can be added", async ({ mount }) => {
  const component = await mount(<CellListHarness initialCells={scaffold()} />);

  await component.getByTestId("notebook-add-code").click();
  await expect(component.getByTestId("cell-count")).toHaveText("5");

  await component.getByTestId("notebook-add-markdown").click();
  await expect(component.getByTestId("cell-count")).toHaveText("6");
});

test("a cell can be inserted directly below another", async ({ mount }) => {
  const component = await mount(<CellListHarness initialCells={scaffold()} />);
  await component.getByTestId("add-code-below-intro").click();
  const ids = (await component.getByTestId("cell-ids").textContent())!.split(
    ",",
  );
  expect(ids[0]).toBe("intro");
  expect(ids[1]).toMatch(/^cell-/);
});

test("a markdown cell can be inserted below any cell", async ({ mount }) => {
  const component = await mount(<CellListHarness initialCells={scaffold()} />);
  await component.getByTestId("add-markdown-below-extract").click();
  const ids = (await component.getByTestId("cell-ids").textContent())!.split(
    ",",
  );
  expect(ids[4]).toMatch(/^note-/);
});

test("cell controls are visible without hovering", async ({ mount }) => {
  // These are the only way to reorder or extend a notebook; a control found
  // only by hovering is a control most people never find.
  const component = await mount(<CellListHarness initialCells={scaffold()} />);
  await expect(component.getByTestId("cell-toolbar-extract")).toBeVisible();
  await expect(component.getByTestId("move-up-extract")).toBeVisible();
  await expect(component.getByTestId("add-code-below-extract")).toBeVisible();
});

test("duplicating a cell copies it directly below", async ({ mount }) => {
  const component = await mount(<CellListHarness initialCells={scaffold()} />);
  await component.getByTestId("duplicate-imports").click();

  const ids = (await component.getByTestId("cell-ids").textContent())!.split(
    ",",
  );
  expect(ids).toHaveLength(5);
  expect(ids[1]).toBe("imports");
  expect(ids[2]).toMatch(/^cell-/);
});

test("cells can be reordered", async ({ mount }) => {
  const component = await mount(<CellListHarness initialCells={scaffold()} />);
  await component.getByTestId("move-up-imports").click();
  await expect(component.getByTestId("cell-ids")).toHaveText(
    "imports,intro,test-connection,extract",
  );
});

test("a markdown cell shows its position, so ordering is legible", async ({
  mount,
}) => {
  const component = await mount(<CellListHarness initialCells={scaffold()} />);
  await expect(component.getByTestId("cell-intro")).toContainText("[1]");
});

test("run is not offered before the source exists", async ({ mount }) => {
  // An execution names a revision of a stored notebook. Before there is one,
  // the control is absent rather than present and inert.
  const component = await mount(<CellListHarness initialCells={scaffold()} />);
  await expect(component.getByTestId("run-cell-extract")).toHaveCount(0);
});

test("run is offered once the notebook can be executed", async ({ mount }) => {
  const component = await mount(
    <CellListHarness initialCells={scaffold()} runnable />,
  );
  await component.getByTestId("run-cell-extract").click();
  await expect(component.getByTestId("ran-cell")).toHaveText("extract");
});
