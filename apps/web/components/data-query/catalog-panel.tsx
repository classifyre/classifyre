"use client";

import * as React from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  Lock,
  Play,
  Table2,
  CircleSlash,
} from "lucide-react";
import { Input } from "@workspace/ui/components/input";
import { Switch } from "@workspace/ui/components/switch";
import { Label } from "@workspace/ui/components/label";
import { SourceIcon } from "@workspace/ui/components/source-icon";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { useNamespace } from "@/components/namespace-provider";
import type { QueryCatalog, QueryCatalogTable } from "@/lib/data-query";

/**
 * What there is to query: sources, then tables, then columns. A table you
 * can query has a play mark and inserts its name on click; one you cannot is
 * shown locked (or why it cannot be read at all), so people see what exists
 * and what to ask for.
 */
export function CatalogPanel({
  catalog,
  onInsert,
}: {
  catalog: QueryCatalog | null;
  onInsert: (text: string) => void;
}) {
  const { t } = useTranslation();
  const { nsHref } = useNamespace();
  const [filter, setFilter] = React.useState("");
  const [onlyQueryable, setOnlyQueryable] = React.useState(false);
  const [open, setOpen] = React.useState<Record<string, boolean>>({});

  const needle = filter.trim().toLowerCase();
  const sources = (catalog?.sources ?? [])
    .map((source) => ({
      ...source,
      tables: source.tables.filter(
        (table) =>
          (!onlyQueryable || table.canQuery) &&
          (!needle ||
            table.sqlName.includes(needle) ||
            table.name.toLowerCase().includes(needle) ||
            table.columns.some((c) => c.name.toLowerCase().includes(needle))),
      ),
    }))
    .filter((source) => source.tables.length);

  const icon = (table: QueryCatalogTable) =>
    table.canQuery ? (
      <Play className="h-3 w-3 shrink-0 text-emerald-600" />
    ) : !table.queryable ? (
      <CircleSlash className="h-3 w-3 shrink-0 text-muted-foreground" />
    ) : (
      <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />
    );

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3"
      data-testid="query-catalog"
    >
      <Input
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder={t("dataQuery.catalogSearch")}
        className="h-8 text-sm"
      />
      <div className="flex items-center gap-2">
        <Switch
          id="only-queryable"
          checked={onlyQueryable}
          onCheckedChange={setOnlyQueryable}
        />
        <Label htmlFor="only-queryable" className="text-xs font-normal">
          {t("dataQuery.onlyQueryable")}
        </Label>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-auto pr-1 text-sm">
        {catalog && !sources.length && (
          <p className="text-xs text-muted-foreground">
            {t("dataQuery.noTables")}
          </p>
        )}
        {sources.map((source) => (
          <div key={source.id}>
            <div className="flex items-center gap-1.5 py-1 font-medium">
              <SourceIcon source={source.type} size="sm" />
              <span className="truncate" title={source.name}>
                {source.name}
              </span>
              <code className="ml-auto text-[10px] text-muted-foreground">
                {source.sqlName}
              </code>
            </div>
            {source.tables.map((table) => {
              const expanded = open[table.assetId] ?? false;
              return (
                <div key={table.assetId} className="pl-2">
                  <div
                    className={cn(
                      "group flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted",
                      !table.canQuery && "text-muted-foreground",
                    )}
                    title={
                      table.canQuery
                        ? table.sqlName
                        : (table.reason ?? t("dataQuery.locked"))
                    }
                  >
                    <button
                      type="button"
                      className="shrink-0"
                      onClick={() =>
                        setOpen((state) => ({
                          ...state,
                          [table.assetId]: !expanded,
                        }))
                      }
                      aria-label={table.sqlName}
                    >
                      {expanded ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                    </button>
                    {icon(table)}
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left font-mono text-xs"
                      onClick={() => table.canQuery && onInsert(table.sqlName)}
                      disabled={!table.canQuery}
                      data-testid={`catalog-table-${table.sqlName}`}
                    >
                      {table.schema}.{table.table}
                    </button>
                    <Link
                      href={nsHref(`/assets/${table.assetId}`)}
                      className="hidden shrink-0 text-muted-foreground group-hover:inline"
                      title={table.name}
                    >
                      <Table2 className="h-3 w-3" />
                    </Link>
                  </div>
                  {expanded && (
                    <div className="space-y-0.5 py-0.5 pl-7">
                      {!table.canQuery && (
                        <p className="text-[11px] text-muted-foreground">
                          {table.queryable
                            ? t("dataQuery.locked")
                            : (table.reason ?? t("dataQuery.notQueryable"))}
                        </p>
                      )}
                      {table.columns.map((column) => (
                        <button
                          key={column.name}
                          type="button"
                          className="flex w-full items-center gap-2 rounded px-1 text-left font-mono text-[11px] hover:bg-muted"
                          onClick={() => onInsert(column.name)}
                        >
                          <span className="truncate">{column.name}</span>
                          <span className="ml-auto truncate text-muted-foreground">
                            {column.type}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
