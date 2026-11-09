"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import type { QueryRows } from "@/lib/data-query";

const ROW_HEIGHT = 30;

function display(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * The rows of a result: sortable, sticky header, only the visible rows in the
 * DOM, so ten thousand rows scroll as smoothly as ten.
 */
export function ResultsGrid({
  result,
  height = 420,
}: {
  result: QueryRows;
  height?: number;
}) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const columns = React.useMemo<ColumnDef<unknown[]>[]>(
    () =>
      result.columns.map((column, index) => ({
        id: `${index}:${column.name}`,
        header: column.name,
        accessorFn: (row) => row[index],
        meta: { type: column.type },
        sortUndefined: "last",
        sortingFn: (a, b, id) => {
          const x = a.getValue(id);
          const y = b.getValue(id);
          if (x === y) return 0;
          if (x === null || x === undefined) return 1;
          if (y === null || y === undefined) return -1;
          if (typeof x === "number" && typeof y === "number") return x - y;
          return display(x).localeCompare(display(y), undefined, {
            numeric: true,
          });
        },
      })),
    [result.columns],
  );

  const table = useReactTable({
    data: result.rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const parentRef = React.useRef<HTMLDivElement>(null);
  const rows = table.getRowModel().rows;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });
  const items = virtualizer.getVirtualItems();
  const paddingTop = items.length ? items[0]!.start : 0;
  const paddingBottom = items.length
    ? virtualizer.getTotalSize() - items[items.length - 1]!.end
    : 0;

  return (
    <div
      ref={parentRef}
      className="overflow-auto rounded-md border"
      style={{ maxHeight: height }}
      data-testid="query-results"
    >
      <table className="w-full border-collapse font-mono text-xs">
        <thead className="sticky top-0 z-10 bg-muted">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              <th className="w-12 border-b px-2 py-1.5 text-right font-normal text-muted-foreground">
                #
              </th>
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                const type = (
                  header.column.columnDef.meta as { type?: string } | undefined
                )?.type;
                return (
                  <th
                    key={header.id}
                    className="cursor-pointer select-none whitespace-nowrap border-b border-l px-2 py-1.5 text-left font-medium"
                    onClick={header.column.getToggleSortingHandler()}
                    title={type}
                  >
                    <span className="inline-flex items-center gap-1">
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      {sorted === "asc" && <ArrowUp className="h-3 w-3" />}
                      {sorted === "desc" && <ArrowDown className="h-3 w-3" />}
                    </span>
                    {type && (
                      <span className="block text-[10px] font-normal text-muted-foreground">
                        {type}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {paddingTop > 0 && (
            <tr>
              <td style={{ height: paddingTop }} />
            </tr>
          )}
          {items.map((item) => {
            const row = rows[item.index]!;
            return (
              <tr
                key={row.id}
                className="odd:bg-muted/30 hover:bg-muted/60"
                style={{ height: ROW_HEIGHT }}
              >
                <td className="border-b px-2 text-right text-muted-foreground">
                  {item.index + 1}
                </td>
                {row.getVisibleCells().map((cell) => {
                  const value = cell.getValue();
                  const text = display(value);
                  return (
                    <td
                      key={cell.id}
                      className={cn(
                        "max-w-[28rem] truncate whitespace-nowrap border-b border-l px-2",
                        value === null && "italic text-muted-foreground",
                        typeof value === "number" && "text-right tabular-nums",
                      )}
                      title={text.length > 40 ? text : undefined}
                    >
                      {value === null ? "null" : text}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {paddingBottom > 0 && (
            <tr>
              <td style={{ height: paddingBottom }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
