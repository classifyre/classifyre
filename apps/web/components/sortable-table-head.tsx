"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { TableHead } from "@workspace/ui/components/table";

export type SortDir = "asc" | "desc";

export interface TableSort<C extends string> {
  sortCol: C;
  sortDir: SortDir;
  onSort: (col: C) => void;
}

/**
 * Sort state of a dense table: clicking the sorted column flips its
 * direction, clicking another sorts by it, starting `firstDir(col)` (newest
 * first for dates, A→Z otherwise).
 */
export function useTableSort<C extends string>(
  initialCol: C,
  initialDir: SortDir = "asc",
  firstDir: (col: C) => SortDir = () => "asc",
): TableSort<C> {
  const [sortCol, setSortCol] = React.useState<C>(initialCol);
  const [sortDir, setSortDir] = React.useState<SortDir>(initialDir);
  const firstDirRef = React.useRef(firstDir);
  firstDirRef.current = firstDir;
  const onSort = React.useCallback(
    (col: C) => {
      if (col === sortCol) {
        setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      } else {
        setSortCol(col);
        setSortDir(firstDirRef.current(col));
      }
    },
    [sortCol],
  );
  return { sortCol, sortDir, onSort };
}

/** Compares for a sort direction: `asc` as is, `desc` reversed. */
export function directed(cmp: number, dir: SortDir): number {
  return dir === "asc" ? cmp : -cmp;
}

/** One sortable column head, the same in every access and activity table. */
export function SortableHead<C extends string>({
  label,
  column,
  sort,
  className,
}: {
  label: string;
  column: C;
  sort: TableSort<C>;
  className?: string;
}) {
  const active = sort.sortCol === column;
  return (
    <TableHead
      className={className}
      aria-sort={
        active ? (sort.sortDir === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button
        type="button"
        onClick={() => sort.onSort(column)}
        className="flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
      >
        {label}
        {active ? (
          sort.sortDir === "asc" ? (
            <ArrowUp className="h-2.5 w-2.5" />
          ) : (
            <ArrowDown className="h-2.5 w-2.5" />
          )
        ) : (
          <ChevronsUpDown className="h-2.5 w-2.5 opacity-40" />
        )}
      </button>
    </TableHead>
  );
}

type SortValue = string | Date | null | undefined;

/**
 * Rows sorted by one key: text A→Z by the reader's locale, dates by time,
 * and rows without a value (no expiry, no name) always last, whichever way.
 */
export function sortRows<T>(
  rows: readonly T[],
  keyOf: (row: T) => SortValue,
  dir: SortDir,
): T[] {
  return [...rows].sort((a, b) => {
    const left = keyOf(a);
    const right = keyOf(b);
    const leftEmpty = left === null || left === undefined || left === "";
    const rightEmpty = right === null || right === undefined || right === "";
    if (leftEmpty || rightEmpty) return leftEmpty === rightEmpty ? 0 : leftEmpty ? 1 : -1;
    if (left instanceof Date || right instanceof Date) {
      return directed(new Date(left).getTime() - new Date(right).getTime(), dir);
    }
    return directed(String(left).localeCompare(String(right)), dir);
  });
}
