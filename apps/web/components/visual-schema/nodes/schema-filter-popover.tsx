"use client";

import * as React from "react";
import { Filter, Plus, Trash2 } from "lucide-react";
import {
  DATA_REQUEST_FILTER_OPS,
  type DataRequestFilter,
  type DataRequestFilterOp,
} from "@workspace/schemas/data-request";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";

export interface SchemaFilterPopoverProps {
  tableId: string;
  columns: ReadonlyArray<{ name: string; type?: string | null }>;
  filters: readonly DataRequestFilter[];
  canEdit: boolean;
  onAdd: (filter: DataRequestFilter) => void;
  onRemove: (indexOrId: number | string) => void;
}

export function SchemaFilterPopover({
  tableId,
  columns,
  filters,
  canEdit,
  onAdd,
  onRemove,
}: SchemaFilterPopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const [column, setColumn] = React.useState(columns[0]?.name ?? "");
  const [op, setOp] = React.useState<DataRequestFilterOp>("=");
  const [rawValue, setRawValue] = React.useState("");

  React.useEffect(() => {
    if (!column && columns[0]) setColumn(columns[0].name);
  }, [column, columns]);

  const needsValue = op !== "IS NULL" && op !== "IS NOT NULL";
  const isList = op === "IN" || op === "NOT IN";

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!column) return;
    if (isList) {
      const values = rawValue
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
      if (values.length === 0) return;
      onAdd({ column, op, values });
    } else if (needsValue) {
      if (!rawValue.trim()) return;
      onAdd({ column, op, value: rawValue.trim() });
    } else {
      onAdd({ column, op });
    }
    setRawValue("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 font-mono text-[10px] transition-colors",
            filters.length > 0
              ? "bg-accent text-accent-foreground font-semibold"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
          title={t("dataRequest.filters.title")}
          data-testid={`table-filters-${tableId}`}
        >
          <Filter className="h-3 w-3" />
          {filters.length > 0 && <span>{filters.length}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 space-y-3 p-3"
        align="end"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("dataRequest.filters.title")}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {filters.length}
          </span>
        </div>

        {filters.length > 0 ? (
          <ul className="space-y-1.5">
            {filters.map((f, idx) => (
              <li
                key={f.id ?? idx}
                className="flex items-center gap-1.5 rounded-xs border border-border/60 bg-muted/40 px-2 py-1 font-mono text-[11px]"
              >
                <span className="truncate font-medium">{f.column}</span>
                <span className="font-semibold text-[var(--accent-ink)]">
                  {f.op}
                </span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {f.values
                    ? `(${f.values.join(", ")})`
                    : f.value !== undefined && f.value !== null
                      ? String(f.value)
                      : ""}
                </span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => onRemove(f.id ?? idx)}
                    className="rounded-xs p-0.5 text-muted-foreground hover:text-destructive"
                    aria-label={t("common.delete")}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("dataRequest.filters.empty")}
          </p>
        )}

        {canEdit && columns.length > 0 && (
          <form onSubmit={handleAdd} className="space-y-2 border-t pt-2.5">
            <div className="grid grid-cols-2 gap-1.5">
              <Select value={column} onValueChange={setColumn}>
                <SelectTrigger className="h-7 text-xs" data-testid="filter-column">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {columns.map((c) => (
                    <SelectItem key={c.name} value={c.name} className="text-xs">
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={op}
                onValueChange={(v) => setOp(v as DataRequestFilterOp)}
              >
                <SelectTrigger className="h-7 font-mono text-xs" data-testid="filter-op">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATA_REQUEST_FILTER_OPS.map((item) => (
                    <SelectItem
                      key={item}
                      value={item}
                      className="font-mono text-xs"
                    >
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {needsValue && (
              <Input
                value={rawValue}
                onChange={(e) => setRawValue(e.target.value)}
                placeholder={
                  isList
                    ? t("dataRequest.filters.listPlaceholder")
                    : t("dataRequest.filters.valuePlaceholder")
                }
                className="h-7 font-mono text-xs"
                data-testid="filter-value"
              />
            )}
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              className="h-7 w-full text-xs"
              data-testid="filter-add"
            >
              <Plus className="mr-1 h-3 w-3" />
              {t("dataRequest.filters.add")}
            </Button>
          </form>
        )}
      </PopoverContent>
    </Popover>
  );
}
