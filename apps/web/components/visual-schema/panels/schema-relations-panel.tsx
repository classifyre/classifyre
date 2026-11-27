"use client";

import * as React from "react";
import {
  AlertTriangle,
  ArrowRight,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  DATA_REQUEST_CARDINALITIES,
  DATA_REQUEST_JOIN_TYPES,
  type DataRequestCardinality,
  type DataRequestJoinType,
} from "@workspace/schemas/data-request";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import type { QueryCatalogTable } from "@/lib/data-query";
import { findLinks, type SuggestedLink } from "../lib/find-links";
import type { VisualSchemaAdapter } from "../types";

export interface SchemaRelationsPanelProps {
  adapter: VisualSchemaAdapter;
  selectedJoinId: string | null;
  onSelectAndFrameJoin: (
    joinId: string,
    leftTableId: string,
    rightTableId: string,
  ) => void;
}

export function SchemaRelationsPanel({
  adapter,
  selectedJoinId,
  onSelectAndFrameJoin,
}: SchemaRelationsPanelProps) {
  const { t } = useTranslation();
  const { spec, catalog, capabilities } = adapter;
  const [filter, setFilter] = React.useState("");
  const [addOpen, setAddOpen] = React.useState(false);

  const [leftTableId, setLeftTableId] = React.useState("");
  const [leftColumn, setLeftColumn] = React.useState("");
  const [rightTableId, setRightTableId] = React.useState("");
  const [rightColumn, setRightColumn] = React.useState("");
  const [joinType, setJoinType] = React.useState<DataRequestJoinType>("INNER");
  const [cardinality, setCardinality] =
    React.useState<DataRequestCardinality>("N-1");

  const tablesById = React.useMemo(
    () => new Map(spec.tables.map((tbl) => [tbl.id, tbl])),
    [spec.tables],
  );

  const catalogByAsset = React.useMemo(() => {
    const map = new Map<string, QueryCatalogTable>();
    for (const src of catalog?.sources ?? []) {
      for (const tbl of src.tables) map.set(tbl.assetId, tbl);
    }
    return map;
  }, [catalog]);

  const suggestions = React.useMemo(
    () => findLinks(spec.tables, spec.joins, catalog),
    [spec.tables, spec.joins, catalog],
  );

  const needle = filter.trim().toLowerCase();

  const filteredJoins = React.useMemo(() => {
    if (!needle) return spec.joins;
    return spec.joins.filter((j) => {
      const lt = tablesById.get(j.left.tableId);
      const rt = tablesById.get(j.right.tableId);
      const text = [
        lt?.alias,
        lt?.sqlName,
        j.left.column,
        rt?.alias,
        rt?.sqlName,
        j.right.column,
        j.type,
        j.constraintName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return text.includes(needle);
    });
  }, [spec.joins, tablesById, needle]);

  const columnsOfTable = (tableId: string): string[] => {
    const tbl = tablesById.get(tableId);
    if (!tbl) return [];
    const cat = catalogByAsset.get(tbl.assetId);
    return cat ? cat.columns.map((c) => c.name) : tbl.keep;
  };

  const openAddDialog = () => {
    const t0 = spec.tables[0]?.id ?? "";
    const t1 = spec.tables[1]?.id ?? "";
    setLeftTableId(t0);
    setRightTableId(t1);
    setLeftColumn(columnsOfTable(t0)[0] ?? "");
    setRightColumn(columnsOfTable(t1)[0] ?? "");
    setJoinType("INNER");
    setCardinality("N-1");
    setAddOpen(true);
  };

  const addSuggestion = (s: SuggestedLink) => {
    adapter.addJoin(s.left, s.right, {
      type: "INNER",
      cardinality: s.cardinality,
      origin: s.origin,
      constraintName: s.constraintName,
    });
  };

  const addAllSuggestions = () => {
    if (suggestions.length === 0) return;
    if (adapter.addJoins) {
      adapter.addJoins(
        suggestions.map((s) => ({
          left: s.left,
          right: s.right,
          options: {
            type: "INNER",
            cardinality: s.cardinality,
            origin: s.origin,
            constraintName: s.constraintName,
          },
        })),
      );
    } else {
      for (const s of suggestions) addSuggestion(s);
    }
  };

  const handleCreateManualJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!leftTableId || !rightTableId || leftTableId === rightTableId) return;
    if (!leftColumn || !rightColumn) return;
    adapter.addJoin(
      { tableId: leftTableId, column: leftColumn },
      { tableId: rightTableId, column: rightColumn },
      { type: joinType, cardinality, origin: "manual" },
    );
    setAddOpen(false);
  };

  return (
    <div className="flex h-full flex-col" data-testid="vs-relations-panel">
      <div className="flex items-center gap-1.5 border-b border-border/50 p-2.5">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("visualSchema.relations.filterPlaceholder")}
            className="h-7 pl-7 text-xs"
            data-testid="vs-relations-filter"
          />
        </div>
        {capabilities.canEdit && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 shrink-0 px-2 text-xs"
            disabled={spec.tables.length < 2}
            onClick={openAddDialog}
            data-testid="vs-add-relation-btn"
          >
            <Plus className="mr-1 h-3 w-3" />
            {t("visualSchema.relations.add")}
          </Button>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-2.5">
          {/* Active Joins */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("visualSchema.relations.active")} ({filteredJoins.length})
              </span>
            </div>
            {filteredJoins.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">
                {t("visualSchema.relations.empty")}
              </p>
            ) : (
              <ul className="space-y-1">
                {filteredJoins.map((j) => {
                  const lt = tablesById.get(j.left.tableId);
                  const rt = tablesById.get(j.right.tableId);
                  const missingOrHidden =
                    !lt || !rt || lt.hidden || rt.hidden;
                  const active = selectedJoinId === j.id;
                  return (
                    <li key={j.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() =>
                          onSelectAndFrameJoin(
                            j.id,
                            j.left.tableId,
                            j.right.tableId,
                          )
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onSelectAndFrameJoin(
                              j.id,
                              j.left.tableId,
                              j.right.tableId,
                            );
                          }
                        }}
                        className={cn(
                          "group flex items-center gap-1.5 rounded-xs border px-2 py-1.5 font-mono text-[11px] transition-colors hover:bg-muted/50",
                          active
                            ? "border-[var(--cb-select)] bg-muted/60"
                            : "border-border/50 bg-card",
                        )}
                        data-testid={`vs-relation-row-${j.id}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1 truncate">
                            <span className="truncate font-semibold">
                              {lt?.alias ?? "?"}.{j.left.column}
                            </span>
                            <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                            <span className="truncate font-semibold">
                              {rt?.alias ?? "?"}.{j.right.column}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <Badge variant="outline" className="h-4 px-1 text-[9px]">
                              {j.type}
                            </Badge>
                            {j.cardinality && (
                              <Badge variant="secondary" className="h-4 px-1 text-[9px]">
                                {j.cardinality}
                              </Badge>
                            )}
                            {missingOrHidden && (
                              <AlertTriangle className="h-3 w-3 text-[var(--cb-amber)]" />
                            )}
                          </div>
                        </div>
                        {capabilities.canEdit && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              adapter.removeJoin(j.id);
                            }}
                            className="shrink-0 rounded-xs p-1 text-muted-foreground opacity-70 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                            aria-label={t("visualSchema.properties.deleteJoin")}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Suggested FK Links */}
          {capabilities.canEdit && suggestions.length > 0 && (
            <div className="space-y-1.5 border-t border-border/50 pt-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Sparkles className="h-3 w-3 text-[var(--accent-ink)]" />
                  {t("visualSchema.relations.suggested")} ({suggestions.length})
                </span>
                <button
                  type="button"
                  onClick={addAllSuggestions}
                  className="font-mono text-[10px] font-semibold text-[var(--accent-ink)] hover:underline"
                  data-testid="vs-add-all-suggestions"
                >
                  {t("visualSchema.relations.addAll")}
                </button>
              </div>
              <ul className="space-y-1">
                {suggestions.map((s, idx) => {
                  const lt = tablesById.get(s.left.tableId);
                  const rt = tablesById.get(s.right.tableId);
                  return (
                    <li
                      key={`${s.left.tableId}:${s.left.column}:${s.right.tableId}:${s.right.column}:${idx}`}
                      className="flex items-center gap-1.5 rounded-xs border border-dashed border-border/70 bg-muted/20 px-2 py-1.5 font-mono text-[11px]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1 truncate">
                          <span className="truncate">
                            {lt?.alias ?? "?"}.{s.left.column}
                          </span>
                          <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="truncate">
                            {rt?.alias ?? "?"}.{s.right.column}
                          </span>
                        </div>
                        <div className="mt-0.5 text-[9px] uppercase text-muted-foreground">
                          {t(`visualSchema.origin.${s.origin}`)} · {s.cardinality}
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => addSuggestion(s)}
                      >
                        <Plus className="mr-0.5 h-3 w-3" />
                        {t("visualSchema.relations.addOne")}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Manual Add Relation Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("visualSchema.relations.dialogTitle")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateManualJoin} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="font-mono text-[10px] uppercase text-muted-foreground">
                  {t("visualSchema.relations.leftTable")}
                </label>
                <Select
                  value={leftTableId}
                  onValueChange={(v) => {
                    setLeftTableId(v);
                    setLeftColumn(columnsOfTable(v)[0] ?? "");
                  }}
                >
                  <SelectTrigger className="h-8 font-mono text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {spec.tables.map((tbl) => (
                      <SelectItem key={tbl.id} value={tbl.id} className="font-mono text-xs">
                        {tbl.alias} ({tbl.sqlName.split(".").pop()})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="font-mono text-[10px] uppercase text-muted-foreground">
                  {t("visualSchema.relations.leftColumn")}
                </label>
                <Select value={leftColumn} onValueChange={setLeftColumn}>
                  <SelectTrigger className="h-8 font-mono text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {columnsOfTable(leftTableId).map((c) => (
                      <SelectItem key={c} value={c} className="font-mono text-xs">
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="font-mono text-[10px] uppercase text-muted-foreground">
                  {t("visualSchema.relations.rightTable")}
                </label>
                <Select
                  value={rightTableId}
                  onValueChange={(v) => {
                    setRightTableId(v);
                    setRightColumn(columnsOfTable(v)[0] ?? "");
                  }}
                >
                  <SelectTrigger className="h-8 font-mono text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {spec.tables
                      .filter((tbl) => tbl.id !== leftTableId)
                      .map((tbl) => (
                        <SelectItem key={tbl.id} value={tbl.id} className="font-mono text-xs">
                          {tbl.alias} ({tbl.sqlName.split(".").pop()})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="font-mono text-[10px] uppercase text-muted-foreground">
                  {t("visualSchema.relations.rightColumn")}
                </label>
                <Select value={rightColumn} onValueChange={setRightColumn}>
                  <SelectTrigger className="h-8 font-mono text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {columnsOfTable(rightTableId).map((c) => (
                      <SelectItem key={c} value={c} className="font-mono text-xs">
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="font-mono text-[10px] uppercase text-muted-foreground">
                  {t("visualSchema.properties.joinType")}
                </label>
                <Select
                  value={joinType}
                  onValueChange={(v) => setJoinType(v as DataRequestJoinType)}
                >
                  <SelectTrigger className="h-8 font-mono text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DATA_REQUEST_JOIN_TYPES.map((jt) => (
                      <SelectItem key={jt} value={jt} className="font-mono text-xs">
                        {jt === "FULL" ? "FULL OUTER JOIN" : `${jt} JOIN`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="font-mono text-[10px] uppercase text-muted-foreground">
                  {t("visualSchema.properties.cardinality")}
                </label>
                <Select
                  value={cardinality}
                  onValueChange={(v) =>
                    setCardinality(v as DataRequestCardinality)
                  }
                >
                  <SelectTrigger className="h-8 font-mono text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DATA_REQUEST_CARDINALITIES.map((c) => (
                      <SelectItem key={c} value={c} className="font-mono text-xs">
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAddOpen(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={
                  !leftTableId ||
                  !rightTableId ||
                  leftTableId === rightTableId ||
                  !leftColumn ||
                  !rightColumn
                }
              >
                {t("visualSchema.relations.add")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
