import {
  addCell,
  definesFunction,
  deleteCell,
  duplicateCell,
  missingFunctions,
  moveCell,
  newCellId,
  protectedCellIds,
  updateCellSource,
  type NotebookCell,
} from "./notebook-cells";

const cell = (
  id: string,
  source = "",
  type: "code" | "markdown" = "code",
): NotebookCell => ({ id, type, source });

const scaffold = (): NotebookCell[] => [
  cell("intro", "# docs", "markdown"),
  cell("imports", "from classifyre import Asset, ctx"),
  cell("test-connection", "def test_connection():\n    return {}"),
  cell("extract", "def extract():\n    yield Asset(id='1')"),
];

describe("definesFunction", () => {
  it.each([
    ["def extract():", true],
    ["async def extract():", true],
    ["def extract ():", true],
    ["  def extract():", false], // indented: a method, not a module-level entry point
    ["# def extract():", false],
    ["extract = 3", false],
    ["def extractor():", false],
  ])("%p defines extract: %p", (source, expected) => {
    expect(definesFunction(source, "extract")).toBe(expected);
  });
});

describe("protectedCellIds", () => {
  it("locks the only cell defining each required function", () => {
    const locked = protectedCellIds(scaffold());
    expect([...locked].sort()).toEqual(["extract", "test-connection"]);
  });

  it("leaves ordinary cells deletable", () => {
    const locked = protectedCellIds(scaffold());
    expect(locked.has("imports")).toBe(false);
    expect(locked.has("intro")).toBe(false);
  });

  it("protects the contract, not a particular cell", () => {
    // Once a second cell defines extract, neither is load-bearing on its own --
    // so restructuring a notebook is never blocked by the lock.
    const cells = [
      ...scaffold(),
      cell("extract-2", "def extract():\n    pass"),
    ];
    const locked = protectedCellIds(cells);
    expect(locked.has("extract")).toBe(false);
    expect(locked.has("extract-2")).toBe(false);
    expect(locked.has("test-connection")).toBe(true);
  });

  it("locks nothing once a required function is already gone", () => {
    // Nothing to preserve, and locking an unrelated cell would be arbitrary.
    const cells = scaffold().filter((entry) => entry.id !== "extract");
    expect(protectedCellIds(cells).has("extract")).toBe(false);
  });
});

describe("missingFunctions", () => {
  it("is empty for the scaffold", () => {
    expect(missingFunctions(scaffold())).toEqual([]);
  });

  it("names what a notebook still needs", () => {
    expect(missingFunctions([cell("a", "x = 1")]).sort()).toEqual([
      "extract",
      "test_connection",
    ]);
  });
});

describe("deleteCell", () => {
  it("removes the named cell", () => {
    const next = deleteCell(scaffold(), "imports");
    expect(next.map((entry) => entry.id)).not.toContain("imports");
  });

  it("refuses to empty the notebook", () => {
    // The schema requires at least one cell; failing here beats a save that
    // fails with a message about minItems.
    const single = [cell("only", "x = 1")];
    expect(deleteCell(single, "only")).toEqual(single);
  });
});

describe("addCell", () => {
  it("appends by default", () => {
    const next = addCell(scaffold(), "code");
    expect(next).toHaveLength(5);
    expect(next[4]!.type).toBe("code");
  });

  it("inserts directly after the given index", () => {
    const next = addCell(scaffold(), "markdown", 0);
    expect(next[1]!.type).toBe("markdown");
    expect(next[2]!.id).toBe("imports");
  });

  it("never reuses an id", () => {
    let cells = scaffold();
    for (let index = 0; index < 5; index += 1) cells = addCell(cells, "code");
    expect(new Set(cells.map((entry) => entry.id)).size).toBe(cells.length);
  });
});

describe("duplicateCell", () => {
  it("copies the source under a fresh id, right after the original", () => {
    const next = duplicateCell(scaffold(), 3);
    expect(next).toHaveLength(5);
    expect(next[4]!.source).toBe(next[3]!.source);
    expect(next[4]!.id).not.toBe(next[3]!.id);
  });

  it("is a no-op for an index that does not exist", () => {
    const cells = scaffold();
    expect(duplicateCell(cells, 99)).toEqual(cells);
  });
});

describe("moveCell", () => {
  it("swaps with the neighbour", () => {
    const next = moveCell(scaffold(), 1, -1);
    expect(next.map((entry) => entry.id).slice(0, 2)).toEqual([
      "imports",
      "intro",
    ]);
  });

  it("does nothing at either edge", () => {
    const cells = scaffold();
    expect(moveCell(cells, 0, -1)).toEqual(cells);
    expect(moveCell(cells, cells.length - 1, 1)).toEqual(cells);
  });
});

describe("updateCellSource", () => {
  it("replaces only the named cell", () => {
    const next = updateCellSource(scaffold(), "imports", "import os");
    expect(next[1]!.source).toBe("import os");
    expect(next[2]!.source).toContain("def test_connection");
  });
});

describe("newCellId", () => {
  it("uses a prefix that reflects the cell type", () => {
    expect(newCellId([], "code")).toMatch(/^cell-/);
    expect(newCellId([], "markdown")).toMatch(/^note-/);
  });
});
