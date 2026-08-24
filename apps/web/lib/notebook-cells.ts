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

/**
 * Apply the assistant's notebook edits.
 *
 * Cell-granular rather than "here is the whole notebook": the author is usually
 * looking at the notebook while the assistant works, so replacing every cell to
 * change one of them would throw away anything the model did not think to
 * repeat. Unknown cell ids are skipped rather than throwing — a model that
 * invents an id should cost the user one ignored operation, not the whole reply.
 *
 * Returns the cells plus the ids actually touched, so the caller can say what
 * changed and can tell a no-op reply from a real edit.
 */
export function applyNotebookOperations(
  cells: NotebookCell[],
  operations: readonly NotebookOperation[],
): { cells: NotebookCell[]; touched: string[] } {
  let next = [...cells];
  const touched: string[] = [];

  for (const operation of operations) {
    if (operation.op === "set_cell") {
      if (!next.some((cell) => cell.id === operation.cellId)) continue;
      next = updateCellSource(next, operation.cellId, operation.source);
      touched.push(operation.cellId);
      continue;
    }

    if (operation.op === "delete_cell") {
      // The cell defining a required function is the notebook's contract with
      // the scanner; the assistant may rewrite it, never remove it.
      if (protectedCellIds(next).has(operation.cellId)) continue;
      if (!next.some((cell) => cell.id === operation.cellId)) continue;
      next = deleteCell(next, operation.cellId);
      touched.push(operation.cellId);
      continue;
    }

    const type = operation.cellType ?? "code";
    const cell: NotebookCell = {
      id: newCellId(next, type),
      type,
      source: operation.source ?? "",
    };
    const after = operation.afterCellId
      ? next.findIndex((existing) => existing.id === operation.afterCellId)
      : -1;
    const position = after === -1 ? next.length : after + 1;
    next = [...next.slice(0, position), cell, ...next.slice(position)];
    touched.push(cell.id);
  }

  return { cells: next, touched };
}

/** The edit shape `applyNotebookOperations` understands. */
export type NotebookOperation =
  | { op: "set_cell"; cellId: string; source: string }
  | {
      op: "insert_cell";
      cellType?: "code" | "markdown";
      source?: string;
      afterCellId?: string | null;
    }
  | { op: "delete_cell"; cellId: string };
