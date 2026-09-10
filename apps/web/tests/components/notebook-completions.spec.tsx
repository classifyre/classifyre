import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";
import { CellListHarness } from "./fixtures/cell-list-harness";
import type { NotebookCell } from "@/lib/notebook-cells";

// Monaco is a 9MB bundle that has to load, mount and tokenize before the first
// keystroke lands, and these run alongside the rest of the suite on a shared
// CI box. The default 30s covers that on an idle machine and not much else.
test.describe.configure({ timeout: 60_000 });

/** Mounting, focusing and answering a keystroke, on a loaded machine. */
const READY = 20_000;

const one = (source: string): NotebookCell[] => [
  { id: "only", type: "code", source },
];

/**
 * Type into a cell the way a person does, and hand back the suggestion list.
 *
 * Monaco owns keyboard handling itself and exposes no editable element to
 * target -- only a hidden IME buffer -- so the visible text surface is clicked
 * for focus and the keys go to the page.
 *
 * The text is read back out of the cell before the widget is looked at. An
 * editor that is on screen is not yet an editor that has keyboard focus, so a
 * dropped keystroke is a real failure mode here -- and read back this way it
 * reports itself as the missing text it is, rather than as a suggestion list
 * that mysteriously never opened.
 */
async function suggestionsFor(
  component: any,
  page: any,
  text: string,
  { cpuThrottle = 1 } = {},
) {
  await expect(component.locator(".monaco-editor").first()).toBeVisible({
    timeout: READY,
  });

  // Throttle after mounting, not before: what has to be slow is the editor
  // answering a keystroke, not the bundle arriving.
  const cdp = cpuThrottle > 1 ? await page.context().newCDPSession(page) : null;
  await cdp?.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottle });

  try {
    await component.locator(".view-lines").first().click();
    // A click that has landed is not yet focus taken: Monaco moves it to its
    // own input surface asynchronously, and keys sent before that arrives go
    // nowhere at all. Which element that surface is depends on whether this
    // build uses EditContext, so ask where focus ended up instead.
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Boolean(document.activeElement?.closest(".monaco-editor")),
          ),
        { timeout: READY },
      )
      .toBe(true);
    await page.keyboard.type(text, { delay: 40 });
    // Auto-closing brackets mean the cell holds `Asset()` once `Asset(` is
    // typed, so this is what was typed being present, not the whole line.
    await expect(component.getByTestId("cell-sources")).toContainText(text, {
      timeout: READY,
    });
  } finally {
    await cdp?.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  }

  const suggestions = page.locator(".suggest-widget");
  await expect(suggestions).toBeVisible({ timeout: READY });
  return suggestions;
}

test("ctx. offers the SDK methods that actually exist", async ({
  mount,
  page,
}) => {
  // Generated from apps/cli/src/notebook/sdk.py, so this cannot drift from the
  // runtime the notebook is handed. Typed as a prefix rather than asserting on
  // the whole list, because the suggest widget only renders visible rows.
  const component = await mount(<CellListHarness initialCells={one("")} />);
  const suggestions = await suggestionsFor(component, page, "ctx.secr");
  await expect(suggestions).toContainText("secret");
  // The real signature, taken from the SDK rather than written by hand.
  await expect(suggestions).toContainText("name");
});

test("ctx completions include properties, not just methods", async ({
  mount,
  page,
}) => {
  const component = await mount(<CellListHarness initialCells={one("")} />);
  const suggestions = await suggestionsFor(component, page, "ctx.strat");
  await expect(suggestions).toContainText("strategy");
});

test("member completion hides unrelated language noise", async ({
  mount,
  page,
}) => {
  // After `ctx.` a Python keyword is never valid, so offering one would bury
  // the handful of entries that are.
  const component = await mount(<CellListHarness initialCells={one("")} />);
  const suggestions = await suggestionsFor(component, page, "ctx.");
  // Wait for the member list itself before claiming what is absent from it --
  // "lambda" is missing from an empty widget too.
  await expect(suggestions).toContainText("secret");
  await expect(suggestions).not.toContainText("lambda");
});

test("Asset( offers its fields, required ones first", async ({
  mount,
  page,
}) => {
  const component = await mount(<CellListHarness initialCells={one("")} />);
  const suggestions = await suggestionsFor(component, page, "Asset(");
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
  const suggestions = await suggestionsFor(component, page, "Asset(content_b");
  await expect(suggestions).toContainText("content_bytes");
});

test("the contract functions are offered as snippets", async ({
  mount,
  page,
}) => {
  const component = await mount(<CellListHarness initialCells={one("")} />);
  const suggestions = await suggestionsFor(component, page, "def ");
  await expect(suggestions).toContainText("test_connection");
});

test("an import line offers the runtime's own packages, with versions", async ({
  mount,
  page,
}) => {
  // The whole point of the read-only package list: an author has no other way
  // to learn that duckdb is already there, or at which version.
  const component = await mount(<CellListHarness initialCells={one("")} />);
  const suggestions = await suggestionsFor(component, page, "import duck");
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
  const suggestions = await suggestionsFor(component, page, "from bs");
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
  const suggestions = await suggestionsFor(component, page, "import re");
  await expect(suggestions).toContainText("requests");
  await expect(suggestions).not.toContainText("return");
});

test("the SDK sorts above the runtime packages on an import line", async ({
  mount,
  page,
}) => {
  const component = await mount(<CellListHarness initialCells={one("")} />);
  const suggestions = await suggestionsFor(component, page, "from cl");
  await expect(suggestions.locator(".monaco-list-row").first()).toContainText(
    "classifyre",
  );
});

test("parse() is offered as an SDK global", async ({ mount, page }) => {
  const component = await mount(<CellListHarness initialCells={one("")} />);
  const suggestions = await suggestionsFor(component, page, "par");
  await expect(suggestions).toContainText("parse");
});

test("ordinary Python keywords still complete", async ({ mount, page }) => {
  const component = await mount(<CellListHarness initialCells={one("")} />);
  const suggestions = await suggestionsFor(component, page, "ret");
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
  await suggestionsFor(component, page, "ctx.");

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
  const suggestions = await suggestionsFor(component, page, "flo");
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
  const suggestions = await suggestionsFor(component, page, "conta");
  await expect(suggestions).toContainText("contains");
});

test("Asset offers the platform name that makes cross-system lineage work", async ({
  mount,
  page,
}) => {
  const component = await mount(<CellListHarness initialCells={one("")} />);
  const suggestions = await suggestionsFor(component, page, "Asset(ur");
  await expect(suggestions).toContainText("urn");
});
