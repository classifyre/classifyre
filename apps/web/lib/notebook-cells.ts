/**
 * Cell-list operations, kept out of the components so both the saved editor and
 * the not-yet-created draft behave identically -- and so the "which cells may be
 * deleted" rule is testable on its own.
 */

export interface NotebookCell {
  id: string;
  type: "code" | "markdown";
  source: string;
}

/**
 * The functions a notebook must define to be a connector. Mirrors
 * REQUIRED_FUNCTIONS in apps/cli/src/notebook/contract.py, which is what
 * actually enforces this before a scan.
 */
export const REQUIRED_FUNCTIONS = ["test_connection", "extract"] as const;

/** Whether a cell's source defines `name` at the top level. */
export function definesFunction(source: string, name: string): boolean {
  return new RegExp(`^(?:async\\s+)?def\\s+${name}\\s*\\(`, "m").test(source);
}

/**
 * Cells that cannot be deleted without breaking the source contract.
 *
 * The rule protects the *contract*, not particular cell ids: a cell is locked
 * only while it is the last one defining a required function. Split `extract`
 * into two cells, or move it, and the lock follows the code rather than
 * standing in the way of a rewrite.
 */
export function protectedCellIds(cells: NotebookCell[]): Set<string> {
  const locked = new Set<string>();
  for (const name of REQUIRED_FUNCTIONS) {
    const definers = cells.filter(
      (cell) => cell.type === "code" && definesFunction(cell.source, name),
    );
    if (definers.length === 1) locked.add(definers[0]!.id);
  }
  return locked;
}

/** Which required functions no cell defines yet. */
export function missingFunctions(cells: NotebookCell[]): string[] {
  return REQUIRED_FUNCTIONS.filter(
    (name) =>
      !cells.some(
        (cell) => cell.type === "code" && definesFunction(cell.source, name),
      ),
  );
}

export function newCellId(
  existing: NotebookCell[],
  type: "code" | "markdown",
): string {
  const prefix = type === "code" ? "cell" : "note";
  const taken = new Set(existing.map((cell) => cell.id));
  let index = existing.length + 1;
  while (taken.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

export function addCell(
  cells: NotebookCell[],
  type: "code" | "markdown",
  afterIndex?: number,
): NotebookCell[] {
  const cell: NotebookCell = { id: newCellId(cells, type), type, source: "" };
  const position = afterIndex == null ? cells.length : afterIndex + 1;
  return [...cells.slice(0, position), cell, ...cells.slice(position)];
}

/**
 * Append a template's cells to a notebook, renaming any id already taken.
 *
 * Appended rather than replacing what is there: a template is something you
 * borrow from part-way through writing a connector, and losing the work already
 * on the page to read an example would be a bad trade. Ids are reassigned
 * because two cells with the same id is a save the API rejects.
 */
export function appendCells(
  cells: NotebookCell[],
  incoming: NotebookCell[],
): NotebookCell[] {
  const next = [...cells];
  for (const cell of incoming) {
    const taken = new Set(next.map((existing) => existing.id));
    next.push({
      ...cell,
      id: taken.has(cell.id) ? newCellId(next, cell.type) : cell.id,
    });
  }
  return next;
}

export function duplicateCell(
  cells: NotebookCell[],
  index: number,
): NotebookCell[] {
  const original = cells[index];
  if (!original) return cells;
  const copy: NotebookCell = {
    ...original,
    id: newCellId(cells, original.type),
  };
  return [...cells.slice(0, index + 1), copy, ...cells.slice(index + 1)];
}

export function deleteCell(cells: NotebookCell[], id: string): NotebookCell[] {
  // Never leave an empty notebook: the schema requires at least one cell, so a
  // save would fail with a message about minItems rather than about this.
  if (cells.length <= 1) return cells;
  return cells.filter((cell) => cell.id !== id);
}

export function moveCell(
  cells: NotebookCell[],
  index: number,
  delta: number,
): NotebookCell[] {
  const target = index + delta;
  if (target < 0 || target >= cells.length) return cells;
  const next = [...cells];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export function updateCellSource(
  cells: NotebookCell[],
  id: string,
  source: string,
): NotebookCell[] {
  return cells.map((cell) => (cell.id === id ? { ...cell, source } : cell));
}
