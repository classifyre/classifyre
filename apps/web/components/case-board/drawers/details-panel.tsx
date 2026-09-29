"use client";

import * as React from "react";
import { useReactFlow } from "@xyflow/react";
import { formatDistanceToNowStrict } from "date-fns";
import {
  ArrowLeft,
  Crosshair,
  ExternalLink,
  Loader2,
  Plus,
  Search,
  Unlink,
  Waypoints,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api, type FindingResponseDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Input } from "@workspace/ui/components/input";
import { SeverityBadge } from "@workspace/ui/components/severity-badge";
import { Switch } from "@workspace/ui/components/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@workspace/ui/components/context-menu";
import { cn } from "@workspace/ui/lib/utils";
import { StateChip } from "@workspace/case-board/components/state-chip";
import { EscalationFlag } from "@workspace/case-board/components/finding-node";
import { FingerprintsGraph } from "@/components/fingerprints-graph";
import { LineageView } from "@/components/lineage-view";
import { SimilarFindingsCard } from "@/components/similar-findings-card";
import { WhereElseFound } from "@/components/where-else-found";
import { ESCALATION_INK } from "@/lib/escalation-tone";
import { nsPath } from "@/lib/ns-path";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard, useBoardStore, useUi, useUiStore } from "../store/board-context";
import { addEvidence, attachFinding, detachFinding } from "../store/commands";
import { dismissedLabel, findingVisualState, normalizeSeverity } from "../store/finding-state";
import {
  ASSET_DETAILS_TABS,
  FINDING_DETAILS_TABS,
  type AssetDetailsTab,
  type FindingDetailsTab,
} from "../store/ui-store";
import type { Bubble, BubbleRow, FindingVisualState, SeverityKey } from "../store/types";
import { startTrace } from "../hooks/use-trace";
import { useFlyToEvidence } from "../hooks/use-place-evidence";
import { useTimelineLink } from "../hooks/use-timeline-link";
import { EdgeDetails } from "./edge-details";

const openInTab = (path: string) => window.open(nsPath(path), "_blank", "noopener");

/** Findings of an asset read per page in "Other findings". */
const OTHER_PAGE = 50;
/** `excludeIds` accepts this many; an asset with more in the case pages them out client-side. */
const EXCLUDE_CAP = 1_000;

/**
 * The details panel (PRD §5.9): what is selected on the board, explained —
 * an asset with its findings, duplicates and lineage; a finding with where
 * else it turns up; a relation and why it is there; or a suggested neighbour.
 * Opened by a double click; a single click on something else follows while it
 * is open.
 */
export function DetailsPanel({ onFlyTo }: { onFlyTo: (itemId: string) => void }) {
  const { t } = useTranslation();
  const target = useUi((s) => s.detailsTarget);
  if (!target) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{t("caseBoard.drawers.detailsEmpty")}</p>;
  }
  if ("edgeId" in target) return <EdgeDetails edgeId={target.edgeId} onFlyTo={onFlyTo} />;
  if ("suggestedKey" in target) return <SuggestedDetails suggestedKey={target.suggestedKey} />;
  if (target.findingId) {
    return <FindingDetails key={target.findingId} itemId={target.itemId} findingId={target.findingId} onFlyTo={onFlyTo} />;
  }
  return <AssetDetails key={target.itemId} itemId={target.itemId} onFlyTo={onFlyTo} />;
}

function Empty() {
  const { t } = useTranslation();
  return <p className="py-8 text-center text-sm text-muted-foreground">{t("caseBoard.drawers.detailsEmpty")}</p>;
}

// ─── An asset ─────────────────────────────────────────────────────────────────

function AssetDetails({ itemId, onFlyTo }: { itemId: string; onFlyTo: (itemId: string) => void }) {
  const { t } = useTranslation();
  const ui = useUiStore();
  const bubble = useBoard((s) => s.bubbles.get(itemId));
  const requested = useUi((s) => s.detailsTab);
  const tab: AssetDetailsTab = (ASSET_DETAILS_TABS as readonly string[]).includes(requested ?? "")
    ? (requested as AssetDetailsTab)
    : "inCase";
  const [otherTotal, setOtherTotal] = React.useState<number | null>(null);
  if (!bubble) return <Empty />;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 text-sm" data-testid="asset-details">
      <div className="shrink-0 space-y-1.5">
        <p className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
          {bubble.assetType ?? "asset"} {bubble.sourceName ? `· ${bubble.sourceName}` : ""}
        </p>
        <p className="font-semibold break-words">{bubble.label}</p>
        {bubble.missing && <StateChip tone="destructive">{t("caseBoard.states.deleted")}</StateChip>}
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => onFlyTo(bubble.itemId)}>
            <Crosshair className="size-3" /> {t("caseBoard.drawers.showOnBoard")}
          </Button>
          {bubble.assetId && (
            <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => openInTab(`/assets/${bubble.assetId}`)}>
              <ExternalLink className="size-3" /> {t("caseBoard.menu.openAsset")}
            </Button>
          )}
          {bubble.assetId && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => startTrace(ui, { nodeId: bubble.itemId, assetId: bubble.assetId, label: bubble.label })}
              data-testid="details-show-connections"
            >
              <Waypoints className="size-3" /> {t("caseBoard.menu.showConnections")}
            </Button>
          )}
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => ui.getState().set({ detailsTab: value as AssetDetailsTab })}
        className="flex min-h-0 flex-1 flex-col gap-3"
      >
        <TabsList className="h-8 w-full shrink-0">
          <TabsTrigger value="inCase" className="text-xs" data-testid="details-tab-inCase">
            {t("caseBoard.details.tabs.inCase")} <Count n={bubble.rows.length} />
          </TabsTrigger>
          <TabsTrigger value="other" className="text-xs" data-testid="details-tab-other">
            {t("caseBoard.details.tabs.other")} <Count n={otherTotal} />
          </TabsTrigger>
          <TabsTrigger value="duplicates" className="text-xs" data-testid="details-tab-duplicates">
            {t("caseBoard.details.tabs.duplicates")}
          </TabsTrigger>
          <TabsTrigger value="lineage" className="text-xs" data-testid="details-tab-lineage">
            {t("caseBoard.details.tabs.lineage")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="inCase" className="min-h-0 flex-1 overflow-y-auto">
          <InCaseFindings bubble={bubble} onFlyTo={onFlyTo} />
        </TabsContent>
        {/* Mounted while hidden, so its count shows on the tab before it is opened. */}
        <TabsContent value="other" forceMount className="min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden">
          <OtherFindings bubble={bubble} onTotal={setOtherTotal} />
        </TabsContent>
        <TabsContent value="duplicates" className="min-h-[420px] flex-1">
          {bubble.assetId ? <FingerprintsGraph assetId={bubble.assetId} /> : <Empty />}
        </TabsContent>
        <TabsContent value="lineage" className="min-h-[420px] flex-1">
          {bubble.assetId ? <LineageView assetId={bubble.assetId} /> : <Empty />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Count({ n }: { n: number | null }) {
  if (n === null) return null;
  return <span className="ml-1 font-mono text-[10px] text-muted-foreground tabular-nums">{n > 999 ? "999+" : n}</span>;
}

/** The asset's findings the case holds; one opens its own details. */
function InCaseFindings({ bubble, onFlyTo }: { bubble: Bubble; onFlyTo: (itemId: string) => void }) {
  const { t } = useTranslation();
  const ui = useUiStore();
  const highlights = useBoard((s) => s.items.get(bubble.itemId)?.style.rowHighlights);
  const flyToEvidence = useFlyToEvidence(onFlyTo);
  if (bubble.rows.length === 0) {
    return (
      <div className="space-y-2 py-6 text-center text-sm text-muted-foreground">
        <p>{t("caseBoard.details.noneInCase")}</p>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => ui.getState().set({ detailsTab: "other" })}
        >
          {t("caseBoard.details.browseOther")}
        </Button>
      </div>
    );
  }
  return (
    <ul className="space-y-0.5" data-testid="details-in-case">
      {bubble.rows.map((row) => (
        <li key={row.findingId}>
          <FindingRowView
            row={row}
            attached
            highlight={highlights?.[row.findingId]}
            onOpen={() => ui.getState().openDrawer("details", { details: { itemId: bubble.itemId, findingId: row.findingId } })}
            aside={
              <button
                type="button"
                className="shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:text-foreground focus-visible:opacity-100"
                title={t("caseBoard.drawers.showOnBoard")}
                aria-label={t("caseBoard.drawers.showOnBoard")}
                onClick={() => flyToEvidence(bubble.itemId, row.findingId)}
              >
                <Crosshair className="size-3" />
              </button>
            }
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * Everything else the asset holds: every finding not in the case, read from
 * the corpus a page at a time (the board itself only draws a dozen). Each can
 * be attached here, one by one or ticked together.
 */
function OtherFindings({ bubble, onTotal }: { bubble: Bubble; onTotal: (n: number | null) => void }) {
  const { t } = useTranslation();
  const ui = useUiStore();
  const readOnly = useBoard((s) => s.readOnly);
  const store = useBoardStore();
  const [query, setQuery] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [includeResolved, setIncludeResolved] = React.useState(false);
  const [items, setItems] = React.useState<FindingResponseDto[]>([]);
  const [total, setTotal] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [failed, setFailed] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());

  const attached = React.useMemo(() => new Set(bubble.rows.map((r) => r.findingId)), [bubble.rows]);
  const attachedKey = [...attached].sort().join(",");

  React.useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const load = React.useCallback(
    async (skip: number) => {
      setLoading(true);
      setFailed(false);
      try {
        const res = await api.assets.searchAssetsControllerSearchFindings({
          searchFindingsRequestDto: {
            filters: {
              assetId: [bubble.assetId],
              excludeIds: attachedKey ? attachedKey.split(",").slice(0, EXCLUDE_CAP) : undefined,
              search: search || undefined,
              includeResolved,
            },
            page: { skip, limit: OTHER_PAGE },
          },
        });
        setItems((prev) => (skip === 0 ? res.findings : [...prev, ...res.findings]));
        setTotal(res.total);
      } catch {
        setFailed(true);
        if (skip === 0) setItems([]);
      } finally {
        setLoading(false);
      }
    },
    // attachedKey stands for the attached set: a finding attached here drops out on the next read.
    [bubble.assetId, attachedKey, search, includeResolved],
  );

  React.useEffect(() => {
    void load(0);
  }, [load]);
  React.useEffect(() => onTotal(total), [total, onTotal]);
  React.useEffect(() => () => onTotal(null), [onTotal]);

  // Attached meanwhile (here or on the board): out of this list at once.
  const shown = items.filter((f) => !attached.has(f.id));
  const attach = (ids: string[]) => {
    const s = store.getState();
    for (const id of ids) s.run(attachFinding(bubble.itemId, id));
    setSelected(new Set());
    toast.success(
      ids.length === 1 ? t("caseBoard.details.attachedOne") : t("caseBoard.details.attachedMany", { count: ids.length }),
      { duration: 2000 },
    );
  };
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const picked = [...selected].filter((id) => shown.some((f) => f.id === id));

  return (
    <div className="space-y-2" data-testid="details-other">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder={t("caseBoard.details.searchOther")}
            className="h-8 pl-7 text-xs"
            aria-label={t("caseBoard.details.searchOther")}
          />
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
          <Switch checked={includeResolved} onCheckedChange={setIncludeResolved} className="scale-75" />
          {t("caseBoard.details.includeResolved")}
        </label>
      </div>
      {!readOnly && picked.length > 0 && (
        <div className="flex items-center gap-2 rounded-[4px] border-2 border-accent/40 px-2 py-1 text-xs">
          <span className="min-w-0 flex-1 font-mono">{t("caseBoard.details.selected", { count: picked.length })}</span>
          <Button size="sm" className="h-6 gap-1 px-2 text-[11px]" onClick={() => attach(picked)} data-testid="details-attach-selected">
            <Plus className="size-3" /> {t("caseBoard.details.attachSelected")}
          </Button>
          <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setSelected(new Set())} aria-label={t("common.cancel")}>
            <X className="size-3.5" />
          </button>
        </div>
      )}
      {failed ? (
        <p className="py-4 text-center text-xs text-destructive">{t("caseBoard.details.otherFailed")}</p>
      ) : loading && items.length === 0 ? (
        <p className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> {t("caseBoard.details.loadingOther")}
        </p>
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {search ? t("caseBoard.details.noOtherMatch") : t("caseBoard.details.noOther")}
        </p>
      ) : (
        <ul className="space-y-0.5">
          {shown.map((f) => {
            const row = rowOf(f);
            return (
              <li key={f.id}>
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <div>
                      <FindingRowView
                        row={row}
                        attached={false}
                        leading={
                          readOnly ? null : (
                            <Checkbox
                              checked={selected.has(f.id)}
                              onCheckedChange={(on) => toggle(f.id, on === true)}
                              aria-label={t("caseBoard.details.select")}
                              className="size-3.5"
                            />
                          )
                        }
                        onOpen={() => ui.getState().openDrawer("details", { details: { itemId: bubble.itemId, findingId: f.id } })}
                        aside={
                          !readOnly && (
                            <button
                              type="button"
                              className="inline-flex shrink-0 items-center gap-0.5 rounded-[3px] border border-border px-1 py-px font-mono text-[9px] text-foreground uppercase hover:bg-muted"
                              title={t("caseBoard.bubble.attachHint")}
                              onClick={() => attach([f.id])}
                              data-testid="details-attach"
                            >
                              <Plus className="size-2.5" aria-hidden />
                              {t("caseBoard.bubble.attach")}
                            </button>
                          )
                        }
                      />
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-56">
                    <ContextMenuItem disabled={readOnly} onSelect={() => attach([f.id])}>
                      <Plus className="size-4" /> {t("caseTarget.menu.attach")}
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() => ui.getState().openDrawer("details", { details: { itemId: bubble.itemId, findingId: f.id } })}
                    >
                      <Search className="size-4" /> {t("caseBoard.menu.openDetails")}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={() => openInTab(`/findings/${f.id}`)}>
                      <ExternalLink className="size-4" /> {t("caseBoard.menu.openFinding")}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              </li>
            );
          })}
        </ul>
      )}
      {total !== null && items.length < total && !failed && (
        <Button variant="outline" size="sm" className="h-7 w-full text-xs" disabled={loading} onClick={() => void load(items.length)}>
          {loading ? <Loader2 className="size-3 animate-spin" /> : null}
          {t("caseBoard.details.loadMore", { count: total - items.length })}
        </Button>
      )}
    </div>
  );
}

/** A finding from the corpus in the shape the board's rows take. */
function rowOf(f: FindingResponseDto): BubbleRow {
  const severity = normalizeSeverity(f.severity);
  return {
    findingId: f.id,
    caseFindingId: null,
    typeLabel: f.findingType,
    value: f.matchedContent ?? null,
    severity,
    detector: f.customDetectorName ?? f.detectorType ?? null,
    status: f.status ?? null,
    matchState: null,
    missing: false,
    state: findingVisualState({ status: f.status }),
    note: null,
    escalated: false,
    escalationLabel: null,
    escalatedAt: null,
  };
}

function stateTone(state: FindingVisualState) {
  return state === "resolved"
    ? "success"
    : state === "new"
      ? "accent"
      : state === "gone" || state === "deleted"
        ? "destructive"
        : "muted";
}

/** One finding as a line: severity, type, value, and what state it is in. */
export function FindingRowView({
  row,
  attached,
  selected = false,
  highlight,
  leading,
  aside,
  onOpen,
}: {
  row: BubbleRow;
  attached: boolean;
  selected?: boolean;
  highlight?: string;
  leading?: React.ReactNode;
  aside?: React.ReactNode;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "group/row flex w-full items-center gap-1.5 rounded-[3px] px-1.5 py-1 text-left text-[11px] hover:bg-muted/70",
        selected && "bg-muted",
        highlight && `cb-row-${highlight}`,
        !attached && "text-muted-foreground",
      )}
    >
      {leading}
      <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={onOpen}>
        <SeverityBadge severity={(row.severity ?? "info") as SeverityKey} className="w-[46px] shrink-0 justify-center px-0.5 py-px text-[8px]">
          {t(`caseBoard.severity.${row.severity ?? "info"}`)}
        </SeverityBadge>
        <span className="max-w-[110px] shrink-0 truncate text-muted-foreground">{row.typeLabel}</span>
        <span className={cn("min-w-0 flex-1 truncate font-mono", row.state === "dismissed" && "line-through")}>{row.value ?? ""}</span>
        {attached && row.escalated && (
          <span title={row.escalationLabel ?? t("caseEscalation.state")} className="shrink-0">
            <EscalationFlag size={12} />
          </span>
        )}
        {row.state !== "open" && (
          <StateChip tone={stateTone(row.state)}>
            {row.state === "dismissed" ? t(`caseBoard.states.${dismissedLabel(row.status)}`) : t(`caseBoard.states.${row.state}`)}
          </StateChip>
        )}
      </button>
      {aside}
    </div>
  );
}

// ─── A finding ────────────────────────────────────────────────────────────────

function FindingDetails({
  itemId,
  findingId,
  onFlyTo,
}: {
  itemId: string;
  findingId: string;
  onFlyTo: (itemId: string) => void;
}) {
  const { t } = useTranslation();
  const ui = useUiStore();
  const store = useBoardStore();
  const readOnly = useBoard((s) => s.readOnly);
  const bubble = useBoard((s) => s.bubbles.get(itemId));
  const flyToEvidence = useFlyToEvidence(onFlyTo);
  const requested = useUi((s) => s.detailsTab);
  const tab: FindingDetailsTab = (FINDING_DETAILS_TABS as readonly string[]).includes(requested ?? "")
    ? (requested as FindingDetailsTab)
    : "overview";
  const [finding, setFinding] = React.useState<FindingResponseDto | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    api.findings
      .findingsControllerFindOne({ id: findingId })
      .then((f) => {
        if (active) setFinding(f);
      })
      .catch(() => {
        if (active) setFinding(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [findingId]);

  const attachedRow = bubble?.rows.find((r) => r.findingId === findingId);
  const row = attachedRow ?? bubble?.unattached.find((r) => r.findingId === findingId) ?? (finding ? rowOf(finding) : undefined);
  if (!bubble && !finding && !loading) return <Empty />;
  const attached = !!attachedRow;
  const severity = row?.severity ?? normalizeSeverity(finding?.severity) ?? "info";

  const detach = () =>
    ui.getState().set({
      confirm: {
        title: t("caseBoard.menu.detachTitle"),
        body: t("caseBoard.menu.detachBody"),
        confirmLabel: t("caseBoard.menu.detach"),
        destructive: true,
        onConfirm: () => store.getState().run(detachFinding(itemId, findingId)),
      },
    });

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 text-sm" data-testid="finding-details">
      <div className="shrink-0 space-y-2">
        {bubble && (
          <button
            type="button"
            className="-ml-1 inline-flex max-w-full items-center gap-1 rounded-[3px] px-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => ui.getState().openDrawer("details", { details: { itemId } })}
            title={t("caseBoard.details.backToAsset")}
          >
            <ArrowLeft className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{bubble.label}</span>
          </button>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={severity as SeverityKey}>{t(`caseBoard.severity.${severity}`)}</SeverityBadge>
          <span className="font-medium">{row?.typeLabel ?? finding?.findingType}</span>
          {row && row.state !== "open" && (
            <StateChip tone={stateTone(row.state)}>
              {row.state === "dismissed" ? t(`caseBoard.states.${dismissedLabel(row.status)}`) : t(`caseBoard.states.${row.state}`)}
            </StateChip>
          )}
          <StateChip tone={attached ? "success" : "muted"}>
            {attached ? t("caseTarget.inCaseShort") : t("caseBoard.bubble.notInCase")}
          </StateChip>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {bubble && (
            <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => flyToEvidence(itemId, findingId)}>
              <Crosshair className="size-3" /> {t("caseBoard.drawers.showOnBoard")}
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => openInTab(`/findings/${findingId}`)} data-testid="details-open-finding">
            <ExternalLink className="size-3" /> {t("caseBoard.details.openFindingPage")}
          </Button>
          {!readOnly && bubble && !attached && (
            <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => store.getState().run(attachFinding(itemId, findingId))}>
              <Plus className="size-3" /> {t("caseBoard.bubble.attach")}
            </Button>
          )}
          {!readOnly && attached && (
            <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={detach}>
              <Unlink className="size-3" /> {t("caseBoard.menu.detach")}
            </Button>
          )}
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => ui.getState().set({ detailsTab: value as FindingDetailsTab })}
        className="flex min-h-0 flex-1 flex-col gap-3"
      >
        <TabsList className="h-8 w-full shrink-0">
          <TabsTrigger value="overview" className="text-xs" data-testid="details-tab-overview">
            {t("caseBoard.details.tabs.overview")}
          </TabsTrigger>
          <TabsTrigger value="similar" className="text-xs" data-testid="details-tab-similar">
            {t("caseBoard.details.tabs.similar")}
          </TabsTrigger>
          <TabsTrigger value="whereElse" className="text-xs" data-testid="details-tab-whereElse">
            {t("caseBoard.details.tabs.whereElse")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          {loading && !finding ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <>
              {attachedRow?.escalated && <EscalationNotice findingId={findingId} row={attachedRow} />}
              <pre className="max-h-64 overflow-auto rounded-[4px] border-2 border-border bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap">
                {finding?.contextBefore ? <span className="text-muted-foreground">{finding.contextBefore}</span> : null}
                <mark className="bg-accent text-accent-foreground">{finding?.matchedContent ?? row?.value ?? ""}</mark>
                {finding?.contextAfter ? <span className="text-muted-foreground">{finding.contextAfter}</span> : null}
              </pre>
              <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">{t("caseBoard.details.detector")}</dt>
                <dd className="break-words">{finding?.customDetectorName ?? finding?.detectorType ?? row?.detector ?? "—"}</dd>
                <dt className="text-muted-foreground">{t("caseBoard.details.status")}</dt>
                <dd>{finding?.status ?? row?.status ?? "—"}</dd>
                {finding?.confidence !== undefined && (
                  <>
                    <dt className="text-muted-foreground">{t("caseBoard.details.confidence")}</dt>
                    <dd>{Math.round(finding.confidence * 100)}%</dd>
                  </>
                )}
                {finding?.detectedAt && (
                  <>
                    <dt className="text-muted-foreground">{t("caseBoard.details.detected")}</dt>
                    <dd>{new Date(finding.detectedAt).toLocaleString()}</dd>
                  </>
                )}
                {row?.note && (
                  <>
                    <dt className="text-muted-foreground">{t("caseBoard.details.note")}</dt>
                    <dd className="whitespace-pre-wrap">{row.note}</dd>
                  </>
                )}
              </dl>
            </>
          )}
        </TabsContent>
        <TabsContent value="similar" className="min-h-0 flex-1 overflow-y-auto">
          <SimilarFindingsCard
            embedded
            findingId={findingId}
            matchedContent={finding?.matchedContent ?? row?.value ?? ""}
            assetId={bubble?.assetId ?? finding?.assetId}
            assetName={bubble?.label}
          />
        </TabsContent>
        <TabsContent value="whereElse" className="min-h-0 flex-1 overflow-y-auto">
          {finding?.findingType && finding.matchedContent ? (
            <WhereElseFound
              embedded
              label={finding.findingType}
              value={finding.matchedContent}
              currentAssetId={bubble?.assetId ?? finding.assetId}
            />
          ) : loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("correlation.occurrences.none")}</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Why a finding is escalated — the rule it matched, when — the way to clear
 * the mark once someone has dealt with it, and the timeline entry that
 * escalated it. The finding stays.
 */
function EscalationNotice({ findingId, row }: { findingId: string; row: BubbleRow }) {
  const { t } = useTranslation();
  const store = useBoardStore();
  const readOnly = useBoard((s) => s.readOnly);
  const caseId = useBoard((s) => s.caseId);
  const openTimeline = useTimelineLink();
  const [clearing, setClearing] = React.useState(false);
  const clear = async () => {
    setClearing(true);
    try {
      await api.cases.caseCleanupControllerClearEscalations({
        id: caseId,
        clearCaseEscalationsDto: { findingIds: [findingId] },
      });
      toast.success(t("caseEscalation.cleared"));
      store.getState().refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("caseEscalation.failedToClear"));
    } finally {
      setClearing(false);
    }
  };
  return (
    <div className="flex items-start gap-2.5 rounded-[4px] border-2 border-border p-2.5" data-testid="escalation-notice">
      <EscalationFlag size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className={cn("font-mono text-[10px] font-bold tracking-[0.14em] uppercase", ESCALATION_INK)}>
          {t("caseEscalation.state")}
          {row.escalatedAt ? ` · ${formatDistanceToNowStrict(new Date(row.escalatedAt), { addSuffix: true })}` : ""}
        </p>
        {row.escalationLabel && <p className="text-xs">{t("caseEscalation.matched", { rule: row.escalationLabel })}</p>}
        <button
          type="button"
          className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => void openTimeline({ types: ["FINDINGS_ESCALATED"] })}
        >
          {t("caseBoard.timelineLink.whatChanged")}
        </button>
      </div>
      {!readOnly && (
        <Button variant="outline" size="sm" className="h-7 shrink-0 gap-1 text-xs" disabled={clearing} onClick={() => void clear()} data-testid="escalation-clear">
          {clearing ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" />}
          {t("caseEscalation.clear")}
        </Button>
      )}
    </div>
  );
}

// ─── A suggested neighbour ────────────────────────────────────────────────────

/** A neighbour that is not in the case yet: what it is, and the way in. */
function SuggestedDetails({ suggestedKey }: { suggestedKey: string }) {
  const { t } = useTranslation();
  const suggestion = useBoard((s) => s.suggested.get(suggestedKey));
  const readOnly = useBoard((s) => s.readOnly);
  const store = useBoardStore();
  const ui = useUiStore();
  const rf = useReactFlow();
  if (!suggestion) return <Empty />;
  const add = () => {
    const node = rf.getNode(suggestedKey);
    store.getState().run(
      addEvidence({ entityType: "asset", entityId: suggestion.assetId }, node ? node.position : null, {
        label: suggestion.label,
        assetType: suggestion.assetType,
        sourceType: suggestion.sourceType,
      }),
    );
  };
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 text-sm">
      <div className="shrink-0 space-y-1">
        <p className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
          {suggestion.assetType ?? "asset"} {suggestion.sourceName ? `· ${suggestion.sourceName}` : ""}
        </p>
        <p className="font-semibold">{suggestion.label}</p>
        <p className="text-xs text-muted-foreground">{t("caseBoard.suggested.hint")}</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button size="sm" className="h-7 gap-1 text-xs" disabled={readOnly} onClick={add}>
          <Plus className="size-3" /> {t("caseBoard.suggested.add")}
        </Button>
        <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => openInTab(`/assets/${suggestion.assetId}`)}>
          <ExternalLink className="size-3" /> {t("caseBoard.menu.openAsset")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => startTrace(ui, { nodeId: suggestedKey, assetId: suggestion.assetId, label: suggestion.label })}
        >
          <Waypoints className="size-3" /> {t("caseBoard.menu.showConnections")}
        </Button>
      </div>
      {/* The same graphs as an asset in the case: how it relates before it joins. */}
      <Tabs defaultValue="duplicates" className="flex min-h-0 flex-1 flex-col gap-3">
        <TabsList className="h-8 w-full shrink-0">
          <TabsTrigger value="duplicates" className="text-xs">
            {t("caseBoard.details.tabs.duplicates")}
          </TabsTrigger>
          <TabsTrigger value="lineage" className="text-xs">
            {t("caseBoard.details.tabs.lineage")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="duplicates" className="min-h-[420px] flex-1">
          <FingerprintsGraph assetId={suggestion.assetId} />
        </TabsContent>
        <TabsContent value="lineage" className="min-h-[420px] flex-1">
          <LineageView assetId={suggestion.assetId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
