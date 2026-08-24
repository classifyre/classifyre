import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";
import { CellListHarness } from "./fixtures/cell-list-harness";
import type { NotebookCell } from "@/lib/notebook-cells";

const one = (source: string): NotebookCell[] => [
  { id: "only", type: "code", source },
];

/**
 * Type into a cell the way a person does.
 *
 * Monaco owns keyboard handling itself and exposes no editable element to
 * target -- only a hidden IME buffer -- so the visible text surface is clicked
 * for focus and the keys go to the page.
 */
async function typeInCell(component: any, page: any, text: string) {
  await expect(component.locator(".monaco-editor").first()).toBeVisible({
    timeout: 15_000,
  });
  await component.locator(".view-lines").first().click();
  await page.keyboard.type(text, { delay: 40 });
}

test("ctx. offers the SDK methods that actually exist", async ({
  mount,
  page,
}) => {
  // Generated from apps/cli/src/notebook/sdk.py, so this cannot drift from the
  // runtime the notebook is handed. Typed as a prefix rather than asserting on
  // the whole list, because the suggest widget only renders visible rows.
  const component = await mount(<CellListHarness initialCells={one("")} />);
  await typeInCell(component, page, "ctx.secr");

  const suggestions = component.locator(".suggest-widget");
  await expect(suggestions).toBeVisible({ timeout: 10_000 });
  await expect(suggestions).toContainText("secret");
  // The real signature, taken from the SDK rather than written by hand.
  await expect(suggestions).toContainText("name");
});

test("ctx completions include properties, not just methods", async ({
  mount,
  page,
}) => {
  const component = await mount(<CellListHarness initialCells={one("")} />);
  await typeInCell(component, page, "ctx.strat");

  const suggestions = component.locator(".suggest-widget");
  await expect(suggestions).toBeVisible({ timeout: 10_000 });
  await expect(suggestions).toContainText("strategy");
});

test("member completion hides unrelated language noise", async ({
  mount,
  page,
}) => {
  // After `ctx.` a Python keyword is never valid, so offering one would bury
  // the handful of entries that are.
  const component = await mount(<CellListHarness initialCells={one("")} />);
  await typeInCell(component, page, "ctx.");

  const suggestions = component.locator(".suggest-widget");
  await expect(suggestions).toBeVisible({ timeout: 10_000 });
  await expect(suggestions).not.toContainText("lambda");
});

test("Asset( offers its fields, required ones first", async ({
  mount,
  page,
}) => {
  const component = await mount(<CellListHarness initialCells={one("")} />);
  await typeInCell(component, page, "Asset(");

  const suggestions = component.locator(".suggest-widget");
  await expect(suggestions).toBeVisible({ timeout: 10_000 });
  // `id` is the only field without a default, so it sorts above the rest.
  await expect(suggestions.locator(".monaco-list-row").first()).toContainText(
    "id",
  );
});

test("Asset offers the binary fields a file connector needs", async ({
  mount,
  page,
}) => {
  const component = await mount(<CellListHarness initialCells={one("")} />);
  await typeInCell(component, page, "Asset(content_b");

  const suggestions = component.locator(".suggest-widget");
  await expect(suggestions).toBeVisible({ timeout: 10_000 });
  await expect(suggestions).toContainText("content_bytes");
});

test("the contract functions are offered as snippets", async ({
  mount,
  page,
}) => {
  const component = await mount(<CellListHarness initialCells={one("")} />);
  await typeInCell(component, page, "def ");

  const suggestions = component.locator(".suggest-widget");
  await expect(suggestions).toBeVisible({ timeout: 10_000 });
  await expect(suggestions).toContainText("test_connection");
});

test("an import line offers the runtime's own packages, with versions", async ({
  mount,
  page,
}) => {
  // The whole point of the read-only package list: an author has no other way
  // to learn that duckdb is already there, or at which version.
  const component = await mount(<CellListHarness initialCells={one("")} />);
  await typeInCell(component, page, "import duck");

  const suggestions = component.locator(".suggest-widget");
  await expect(suggestions).toBeVisible({ timeout: 10_000 });
  await expect(suggestions).toContainText("duckdb");
  await expect(suggestions).toContainText(/duckdb \d+\./);
});

test("an import line offers the import name, not the distribution name", async ({
  mount,
  page,
}) => {
  // `pip install beautifulsoup4`, `import bs4`. Offering the wrong half of that
  // is worse than offering nothing.
  const component = await mount(<CellListHarness initialCells={one("")} />);
  await typeInCell(component, page, "from bs");

  const suggestions = component.locator(".suggest-widget");
  await expect(suggestions).toBeVisible({ timeout: 10_000 });
  await expect(suggestions).toContainText("bs4");
  await expect(suggestions).toContainText("beautifulsoup4");
});

test("an import line does not offer language keywords", async ({
  mount,
  page,
}) => {
  // "re" prefixes both the `return` keyword and two real modules. On an import
  // line only the modules can be right, and burying them under the language is
  // what makes a completion list useless.
  const component = await mount(<CellListHarness initialCells={one("")} />);
  await typeInCell(component, page, "import re");

  const suggestions = component.locator(".suggest-widget");
  await expect(suggestions).toBeVisible({ timeout: 10_000 });
  await expect(suggestions).toContainText("requests");
  await expect(suggestions).not.toContainText("return");
});

test("the SDK sorts above the runtime packages on an import line", async ({
  mount,
  page,
}) => {
  const component = await mount(<CellListHarness initialCells={one("")} />);
  await typeInCell(component, page, "from cl");

  const suggestions = component.locator(".suggest-widget");
  await expect(suggestions).toBeVisible({ timeout: 10_000 });
  await expect(suggestions.locator(".monaco-list-row").first()).toContainText(
    "classifyre",
  );
});

test("parse() is offered as an SDK global", async ({ mount, page }) => {
  const component = await mount(<CellListHarness initialCells={one("")} />);
  await typeInCell(component, page, "par");

  const suggestions = component.locator(".suggest-widget");
  await expect(suggestions).toBeVisible({ timeout: 10_000 });
  await expect(suggestions).toContainText("parse");
});

test("ordinary Python keywords still complete", async ({ mount, page }) => {
  const component = await mount(<CellListHarness initialCells={one("")} />);
  await typeInCell(component, page, "ret");

  const suggestions = component.locator(".suggest-widget");
  await expect(suggestions).toBeVisible({ timeout: 10_000 });
  await expect(suggestions).toContainText("return");
});

test("suggestions are not clipped by the cell they sit in", async ({
  mount,
  page,
}) => {
  // A cell is a fixed-height, overflow-hidden box inside cards inside a
  // scrolling page. An absolutely-positioned suggestion list is clipped by the
  // first of those ancestors -- often after a row or two -- so the list is
  // rendered as an overflow widget instead, which escapes them.
  const component = await mount(
    <CellListHarness initialCells={one("")} clipped />,
  );
  await typeInCell(component, page, "ctx.");

  const widget = page.locator(".suggest-widget");
  await expect(widget).toBeVisible({ timeout: 10_000 });

  const report = await page.evaluate(() => {
    const w = document.querySelector(".suggest-widget") as HTMLElement;
    const clipper = document.querySelector(
      '[data-testid="clipper"]',
    ) as HTMLElement;
    const rows = Array.from(
      document.querySelectorAll(".suggest-widget .monaco-list-row"),
    ) as HTMLElement[];
    const last = rows[rows.length - 1];
    const box = last?.getBoundingClientRect();
    const hit = box
      ? document.elementFromPoint(box.left + 5, box.top + box.height / 2)
      : null;
    return {
      position: getComputedStyle(w).position,
      extendsPastClipper:
        w.getBoundingClientRect().bottom >
        clipper.getBoundingClientRect().bottom,
      rows: rows.length,
      lastRowClickable: Boolean(hit && last?.contains(hit)),
    };
  });

  // `fixed` is what takes the list out of every ancestor's overflow.
  expect(report.position).toBe("fixed");
  expect(report.extendsPastClipper).toBe(true);
  expect(report.rows).toBeGreaterThan(3);
  expect(report.lastRowClickable).toBe(true);
});

test("the relationship builders are offered, and flow keeps its ends named", async ({
  mount,
  page,
}) => {
  // The distinction between lineage and every other kind of link only exists if
  // the author can see that `flow` and `contains` are different functions. An
  // author who cannot find them reaches for `links` and flattens it back out.
  const component = await mount(<CellListHarness initialCells={one("")} />);
  await typeInCell(component, page, "flo");

  const suggestions = component.locator(".suggest-widget");
  await expect(suggestions).toBeVisible({ timeout: 10_000 });
  await expect(suggestions).toContainText("flow");
  // Both ends keyword-only: a reversed lineage edge is silently wrong rather
  // than loudly broken, so the snippet must not fill them positionally.
  await expect(suggestions).toContainText("upstream");
  await expect(suggestions).toContainText("downstream");
});

test("the other relationship kinds are offered too", async ({
  mount,
  page,
}) => {
  const component = await mount(<CellListHarness initialCells={one("")} />);
  await typeInCell(component, page, "conta");

  const suggestions = component.locator(".suggest-widget");
  await expect(suggestions).toBeVisible({ timeout: 10_000 });
  await expect(suggestions).toContainText("contains");
});

test("Asset offers the platform name that makes cross-system lineage work", async ({
  mount,
  page,
}) => {
  const component = await mount(<CellListHarness initialCells={one("")} />);
  await typeInCell(component, page, "Asset(ur");

  const suggestions = component.locator(".suggest-widget");
  await expect(suggestions).toBeVisible({ timeout: 10_000 });
  await expect(suggestions).toContainText("urn");
});
