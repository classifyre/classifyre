"use client";

import * as React from "react";
import { useReactFlow } from "@xyflow/react";
import { AlertTriangle, Crosshair, Loader2, Plus, Route } from "lucide-react";
import type { BoardTraceNodeDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { getAssetKindIcon } from "@/lib/asset-kind";
import type { TranslationKey } from "@/i18n";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard, useUi, useUiStore } from "../store/board-context";
import {
  pathToSeed,
  TRACE_KIND_STROKE,
  TRACE_LIMIT,
  TRACE_LIMIT_MAX,
  type TraceDepth,
  type TraceKind,
} from "../store/trace";
import { useAddFromTrace } from "../hooks/use-trace";
import { DirectionSwitch, HopLadder, KindChips } from "../ui/trace-controls";

type Side = "up" | "down" | "side";

const DEPTHS: Array<{ value: TraceDepth; label: string }> = [
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: 4, label: "4" },
  { value: 5, label: "5" },
  { value: "all", label: "∞" },
];

const SIDE_META: Record<Side, { mark: string; title: TranslationKey }> = {
  up: { mark: "↑", title: "caseBoard.connections.groups.up" },
  down: { mark: "↓", title: "caseBoard.connections.groups.down" },
  side: { mark: "≈", title: "caseBoard.connections.groups.side" },
};

/**
 * "Show connections" (replaces "Find path"): what the asset is connected to
 * beyond the board — upstream, downstream and alongside, hop by hop — and the
 * way to bring all of it, one side of it, one asset or the route to one asset
 * into the case. The canvas draws the same trace as ghosts while this is open.
 */
export function ConnectionsPanel({ onFlyTo }: { onFlyTo: (nodeId: string) => void }) {
  const { t } = useTranslation();
  const ui = useUiStore();
  const rf = useReactFlow();
  const trace = useUi((s) => s.trace);
  const result = useUi((s) => s.traceResult);
  const loading = useUi((s) => s.traceLoading);
  const error = useUi((s) => s.traceError);
  const itemByAsset = useBoard((s) => s.itemByAsset);
  const readOnly = useBoard((s) => s.readOnly);
  const addFromTrace = useAddFromTrace();

  if (!trace) return <p className="py-8 text-center text-sm text-muted-foreground">{t("caseBoard.connections.empty")}</p>;
  const patch = (next: Partial<typeof trace>) => ui.getState().set({ trace: { ...trace, ...next } });
  const kinds = new Set(trace.kinds);
  const toggleKind = (kind: TraceKind) => {
    const next = new Set(kinds);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    patch({ kinds: [...next] });
  };

  const others = (result?.nodes ?? []).filter((n) => n.side !== "seed");
  const inCase = (n: BoardTraceNodeDto) => n.type === "asset" && itemByAsset.has(n.id);
  const addable = (n: BoardTraceNodeDto) => n.type === "asset" && !n.missing && !inCase(n);
  const missing = others.filter(addable);
  const boardNodeOf = (n: BoardTraceNodeDto) =>
    itemByAsset.get(n.id) ?? (rf.getNode(`sg:${n.id}`) ? `sg:${n.id}` : `tr:${n.id}`);
  const groups = (["up", "down", "side"] as const)
    .map((side) => ({ side, nodes: others.filter((n) => n.side === side) }))
    .filter((g) => g.nodes.length > 0);
  const SeedIcon = getAssetKindIcon(result?.nodes.find((n) => n.side === "seed")?.assetType ?? null);

  return (
    <div className="space-y-5" data-testid="connections-panel">
      <section className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-foreground ring-2 ring-[var(--cb-evidence)] ring-offset-2 ring-offset-background">
          <SeedIcon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">{t("caseBoard.connections.tracing")}</p>
          <button
            type="button"
            className="block max-w-full truncate text-left text-[15px] font-semibold hover:underline"
            onClick={() => onFlyTo(trace.seedNodeId)}
            title={trace.seedLabel}
          >
            {trace.seedLabel}
          </button>
        </div>
        {loading && <Loader2 className="mt-1 size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />}
      </section>

      <section className="space-y-3">
        <DirectionSwitch value={trace.direction} onChange={(direction) => patch({ direction })} />
        <div className="space-y-1.5">
          <p className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">{t("caseBoard.connections.hops")}</p>
          <HopLadder value={trace.depth} options={DEPTHS} onChange={(depth) => patch({ depth })} label={t("caseBoard.connections.hops")} />
        </div>
        <div className="space-y-1.5">
          <p className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">{t("caseBoard.connections.follow")}</p>
          <KindChips value={kinds} onToggle={toggleKind} />
        </div>
      </section>

      {error ? (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden /> {error}
        </p>
      ) : result && others.length === 0 && !loading ? (
        <p className="rounded-[4px] border-2 border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
          {t("caseBoard.connections.none")}
        </p>
      ) : result ? (
        <>
          <section className="flex items-center gap-3 border-y-2 border-border py-3">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-sm font-bold tabular-nums">
                {others.length === 1
                  ? t("caseBoard.connections.countOne")
                  : t("caseBoard.connections.count", { count: others.length })}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("caseBoard.connections.notInCase", { count: missing.length })}
              </p>
            </div>
            {!readOnly && missing.length > 0 && (
              <Button
                size="sm"
                className="h-8 shrink-0 gap-1"
                onClick={() => addFromTrace(missing, t("caseBoard.connections.addAll", { count: missing.length }))}
                data-testid="connections-add-all"
              >
                <Plus className="size-3.5" strokeWidth={3} /> {t("caseBoard.connections.addAll", { count: missing.length })}
              </Button>
            )}
          </section>

          {result.truncated && (
            <section
              className="flex items-start gap-2 rounded-[4px] border-2 border-dashed border-border px-3 py-2 text-xs"
              data-testid="connections-truncated"
            >
              <AlertTriangle className="mt-px size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1 space-y-1.5">
                <p>
                  {(trace.limit ?? TRACE_LIMIT) < TRACE_LIMIT_MAX
                    ? t("caseBoard.connections.limited", { count: others.length })
                    : t("caseBoard.connections.limitedMax", { count: others.length })}
                </p>
                {(trace.limit ?? TRACE_LIMIT) < TRACE_LIMIT_MAX && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-[3px] border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase hover:bg-muted"
                    onClick={() => patch({ limit: TRACE_LIMIT_MAX })}
                    data-testid="connections-show-more"
                  >
                    {t("caseBoard.connections.showMore", { count: TRACE_LIMIT_MAX })}
                  </button>
                )}
              </div>
            </section>
          )}

          {groups.map(({ side, nodes }) => {
            const add = nodes.filter(addable);
            const byHop = new Map<number, BoardTraceNodeDto[]>();
            for (const n of [...nodes].sort((a, b) => a.depth - b.depth || a.label.localeCompare(b.label))) {
              const list = byHop.get(n.depth);
              if (list) list.push(n);
              else byHop.set(n.depth, [n]);
            }
            return (
              <section key={side} className="space-y-2" data-testid={`connections-group-${side}`}>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-bold" aria-hidden>
                    {SIDE_META[side].mark}
                  </span>
                  <p className="font-mono text-[10px] tracking-[0.14em] uppercase">
                    {t(SIDE_META[side].title)} <span className="text-muted-foreground">· {nodes.length}</span>
                  </p>
                  <span className="flex-1" />
                  {!readOnly && add.length > 0 && (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-[3px] border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase hover:bg-muted"
                      onClick={() =>
                        addFromTrace(
                          add,
                          add.length === 1
                            ? t("caseBoard.connections.addSideOne")
                            : t("caseBoard.connections.addSide", { count: add.length }),
                        )
                      }
                    >
                      <Plus className="size-3" strokeWidth={3} aria-hidden /> {add.length}
                    </button>
                  )}
                </div>
                {[...byHop.entries()].map(([hop, list]) => (
                  <div key={hop} className="space-y-1">
                    <p className="pl-5 font-mono text-[9px] tracking-[0.12em] text-muted-foreground uppercase">
                      {t("caseBoard.connections.hopLabel", { count: hop })}
                    </p>
                    <ul className="space-y-1">
                      {list.map((n) => (
                        <TraceRow
                          key={n.id}
                          node={n}
                          inCase={inCase(n)}
                          addable={!readOnly && addable(n)}
                          onFly={() => onFlyTo(boardNodeOf(n))}
                          onAdd={() => addFromTrace([n], t("caseBoard.connections.add"))}
                          onAddPath={() => addFromTrace(pathToSeed(result, n.id), t("caseBoard.connections.addPath"))}
                        />
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            );
          })}
        </>
      ) : (
        <div className="flex justify-center py-8">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

function TraceRow({
  node,
  inCase,
  addable,
  onFly,
  onAdd,
  onAddPath,
}: {
  node: BoardTraceNodeDto;
  inCase: boolean;
  addable: boolean;
  onFly: () => void;
  onAdd: () => void;
  onAddPath: () => void;
}) {
  const { t } = useTranslation();
  const Icon = getAssetKindIcon(node.assetType ?? null);
  const kind = (node.viaKind ?? "links") as TraceKind;
  return (
    <li
      className={cn(
        "group flex items-center gap-2 rounded-[4px] border-2 py-1 pr-1 pl-2",
        inCase ? "border-border bg-card" : "border-dashed border-border",
      )}
      data-testid="connections-row"
      data-in-case={inCase}
    >
      <span className="h-6 w-0.5 shrink-0 rounded-full" style={{ background: TRACE_KIND_STROKE[kind] }} aria-hidden />
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={onFly} title={t("caseBoard.drawers.showOnBoard")}>
        <Icon className={cn("size-4 shrink-0", inCase ? "text-foreground" : "text-muted-foreground")} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-sm", !inCase && "text-muted-foreground")}>{node.label}</span>
          <span className="block truncate font-mono text-[10px] text-muted-foreground">
            {[node.sourceName ?? node.sourceType, t(`caseBoard.connections.kinds.${kind}`)].filter(Boolean).join(" · ")}
          </span>
        </span>
      </button>
      {inCase ? (
        <span className="shrink-0 rounded-[3px] bg-[var(--cb-evidence)] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#0a0a0a] uppercase">
          {t("caseBoard.connections.inCase")}
        </span>
      ) : addable ? (
        <>
          {node.depth > 1 && (
            <button
              type="button"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-[3px] text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
              onClick={onAddPath}
              title={t("caseBoard.connections.addPath")}
              aria-label={t("caseBoard.connections.addPath")}
            >
              <Route className="size-3.5" aria-hidden />
            </button>
          )}
          <button
            type="button"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-[3px] border-2 border-foreground bg-foreground text-background hover:bg-foreground/85"
            onClick={onAdd}
            title={t("caseBoard.connections.add")}
            aria-label={t("caseBoard.connections.add")}
            data-testid="connections-add"
          >
            <Plus className="size-3.5" strokeWidth={3} aria-hidden />
          </button>
        </>
      ) : (
        <button
          type="button"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-[3px] text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onFly}
          aria-label={t("caseBoard.drawers.showOnBoard")}
        >
          <Crosshair className="size-3.5" aria-hidden />
        </button>
      )}
    </li>
  );
}
