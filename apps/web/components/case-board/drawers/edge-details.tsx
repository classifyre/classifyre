"use client";

import * as React from "react";
import { formatDistanceToNowStrict } from "date-fns";
import {
  ArrowRight,
  Check,
  Circle,
  ExternalLink,
  FlaskConical,
  Globe,
  Loader2,
  Lock,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api, type ReviewPairResponseDto } from "@workspace/api-client";
import { BOARD_LINK_KINDS, type BoardStance } from "@workspace/schemas/case-board";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Textarea } from "@workspace/ui/components/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { cn } from "@workspace/ui/lib/utils";
import { MatchWeightWaterfall } from "@/components/review/match-weight-waterfall";
import { LineageEvidenceChip } from "@/components/review/lineage-evidence-chip";
import { PairValuesTable } from "@/components/review/pair-values-table";
import { encodePairId, score2 } from "@/components/review/review-format";
import { nsPath } from "@/lib/ns-path";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard, useBoardStore, useUiStore } from "../store/board-context";
import type { BoardState } from "../store/board-store";
import { deleteLinks, promoteLink, removeStance, setStance, updateLink } from "../store/commands";
import { textClaim } from "../store/claims";
import { edgeDrawClass } from "../store/projection";
import { findingNodeId } from "../store/relations";
import { hypothesisMeta } from "../store/selectors";
import { parseBoardEdgeId, type DetailsTarget } from "../store/ui-store";
import type { BoardLink, SystemEdge } from "../store/types";
import { humanizeKind } from "../edges/link-edge";
import { nodeLabel } from "../edges/system-edge";

const openInTab = (path: string) => window.open(nsPath(path), "_blank", "noopener");

/** The parts of the board a relation's details read; each keeps its reference until it changes. */
type RelationState = Pick<BoardState, "items" | "bubbles" | "suggested" | "threads" | "itemByAsset" | "itemByFinding">;

/**
 * Select the maps (stable references) and derive from them, rather than
 * building an object inside a selector: a selector that returns a new object
 * every read makes React re-render forever.
 */
function useRelationState(): RelationState {
  const items = useBoard((s) => s.items);
  const bubbles = useBoard((s) => s.bubbles);
  const suggested = useBoard((s) => s.suggested);
  const threads = useBoard((s) => s.threads);
  const itemByAsset = useBoard((s) => s.itemByAsset);
  const itemByFinding = useBoard((s) => s.itemByFinding);
  return React.useMemo(
    () => ({ items, bubbles, suggested, threads, itemByAsset, itemByFinding }),
    [items, bubbles, suggested, threads, itemByAsset, itemByFinding],
  );
}

/** What a relation's ends are on the board, as far as the details can show them. */
interface EndView {
  label: string;
  /** What opens in the details panel for it; null when it is not on the board. */
  target: DetailsTarget | null;
  /** The board node to fly to. */
  nodeId: string | null;
  kind: "asset" | "finding" | "external" | "item";
}

/** An end of a platform edge (`asset:<id>`, `finding:<id>`, `external:<urn>`). */
function graphEndView(s: RelationState, key: string): EndView {
  const colon = key.indexOf(":");
  const type = key.slice(0, colon);
  const id = key.slice(colon + 1);
  if (type === "asset") {
    const itemId = s.itemByAsset.get(id);
    if (itemId) return { label: s.bubbles.get(itemId)?.label ?? id, target: { itemId }, nodeId: itemId, kind: "asset" };
    const sg = s.suggested.get(`sg:${id}`);
    return { label: sg?.label ?? id, target: sg ? { suggestedKey: sg.key } : null, nodeId: sg ? sg.key : null, kind: "asset" };
  }
  if (type === "finding") {
    const itemId = s.itemByFinding.get(id);
    if (itemId) {
      const nodeId = findingNodeId(itemId, id);
      return { label: nodeLabel(s, nodeId) || id, target: { itemId, findingId: id }, nodeId, kind: "finding" };
    }
    return { label: id, target: null, nodeId: null, kind: "finding" };
  }
  return { label: id, target: null, nodeId: null, kind: "external" };
}

/** An end of a board link or stance: an item, or one finding of an evidence item. */
function itemEndView(s: RelationState, itemId: string, findingId: string | null): EndView {
  const nodeId = findingId ? findingNodeId(itemId, findingId) : itemId;
  const item = s.items.get(itemId);
  const label = nodeLabel(s, nodeId) || nodeLabel(s, itemId);
  const target: DetailsTarget | null =
    item?.kind === "EVIDENCE" ? { itemId, findingId } : null;
  return { label: label || "—", target, nodeId, kind: findingId ? "finding" : "item" };
}

/**
 * A relation between two things on the board, explained: a link someone
 * drew (editable here as on the canvas), one the platform found (why it is
 * there, and for a likely duplicate how strong the match is), or a stance on
 * a hypothesis.
 */
export function EdgeDetails({ edgeId, onFlyTo }: { edgeId: string; onFlyTo: (nodeId: string) => void }) {
  const { t } = useTranslation();
  const ref = parseBoardEdgeId(edgeId);
  if (!ref) return <p className="py-8 text-center text-sm text-muted-foreground">{t("caseBoard.drawers.detailsEmpty")}</p>;
  if (ref.kind === "link") return <LinkDetails linkId={ref.linkId} onFlyTo={onFlyTo} />;
  if (ref.kind === "stance") return <StanceDetails supportId={ref.supportId} onFlyTo={onFlyTo} />;
  return <SystemEdgeDetails systemEdgeId={ref.systemEdgeId} onFlyTo={onFlyTo} />;
}

function Gone() {
  const { t } = useTranslation();
  return <p className="py-8 text-center text-sm text-muted-foreground">{t("caseBoard.edgeDetails.gone")}</p>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

/** "from → to", each end opening its own details and flying to it. */
function Ends({ from, to, onFlyTo }: { from: EndView; to: EndView; onFlyTo: (nodeId: string) => void }) {
  const ui = useUiStore();
  const end = (e: EndView) => (
    <button
      type="button"
      disabled={!e.target && !e.nodeId}
      onClick={() => {
        if (e.target) ui.getState().openDrawer("details", { details: e.target });
        if (e.nodeId) onFlyTo(e.nodeId);
      }}
      className="min-w-0 flex-1 truncate rounded-[3px] border-2 border-border bg-card px-2 py-1 text-left text-xs font-medium hover:border-foreground/40 disabled:cursor-default disabled:hover:border-border"
      title={e.label}
    >
      {e.label}
    </button>
  );
  return (
    <div className="flex items-center gap-1.5" data-testid="edge-ends">
      {end(from)}
      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      {end(to)}
    </div>
  );
}

// ─── A link someone drew ──────────────────────────────────────────────────────

function LinkDetails({ linkId, onFlyTo }: { linkId: string; onFlyTo: (nodeId: string) => void }) {
  const { t } = useTranslation();
  const store = useBoardStore();
  const ui = useUiStore();
  const link = useBoard((s) => s.links.get(linkId));
  const readOnly = useBoard((s) => s.readOnly);
  const rs = useRelationState();
  const ends = React.useMemo(
    () =>
      link
        ? {
            from: itemEndView(rs, link.sourceItemId, link.sourceFindingId),
            to: itemEndView(rs, link.targetItemId, link.targetFindingId),
            // Only a link between evidence names two things the global graph knows.
            promotable:
              rs.items.get(link.sourceItemId)?.kind === "EVIDENCE" && rs.items.get(link.targetItemId)?.kind === "EVIDENCE",
          }
        : null,
    [link, rs],
  );
  if (!link || !ends) return <Gone />;
  const run = (patch: Parameters<typeof updateLink>[1], claim?: string) =>
    store.getState().run(updateLink(link, patch, claim));
  const kinds = [...new Set([link.kind, ...BOARD_LINK_KINDS])];

  return (
    <div className="space-y-4 text-sm" data-testid="link-details">
      <div className="space-y-1">
        <p className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">{t("caseBoard.edgeDetails.link")}</p>
        <p className="text-xs text-muted-foreground">
          {t("caseBoard.edges.by", { name: link.createdBy ?? t("caseBoard.someone") })}
          {" · "}
          {formatDistanceToNowStrict(new Date(link.updatedAt), { addSuffix: true })}
          {link.promotedEdgeId ? ` · ${t("caseBoard.edges.globalBadge")}` : ""}
        </p>
      </div>
      <Ends from={ends.from} to={ends.to} onFlyTo={onFlyTo} />

      <Section title={t("caseBoard.edgeDetails.kind")}>
        <Select value={link.kind} disabled={readOnly} onValueChange={(kind) => run({ kind })}>
          <SelectTrigger className="h-8 w-full text-xs" data-testid="link-kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {kinds.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {humanizeKind(kind, t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Section>

      <div className="grid grid-cols-2 gap-3">
        <Section title={t("caseBoard.edgeDetails.certainty")}>
          <div className="grid grid-cols-2 gap-1 rounded-[4px] border border-border p-0.5">
            {(["CONFIRMED", "SUSPECTED"] as const).map((c) => (
              <button
                key={c}
                type="button"
                disabled={readOnly}
                className={cn(
                  "rounded-[3px] px-1.5 py-1 text-[11px] disabled:opacity-60",
                  link.certainty === c ? "bg-foreground text-background" : "hover:bg-muted",
                )}
                onClick={() => link.certainty !== c && run({ certainty: c })}
                aria-pressed={link.certainty === c}
              >
                {c === "CONFIRMED" ? t("caseBoard.link.confirmed") : t("caseBoard.link.suspected")}
              </button>
            ))}
          </div>
        </Section>
        <Section title={t("caseBoard.link.confidence")}>
          <Select
            value={link.confidence === null ? "none" : String(link.confidence)}
            disabled={readOnly}
            onValueChange={(v) => run({ confidence: v === "none" ? null : Number(v) })}
          >
            <SelectTrigger className="h-8 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              {[0.25, 0.5, 0.75, 1].map((c) => (
                <SelectItem key={c} value={String(c)}>
                  {Math.round(c * 100)}%
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Section>
      </div>

      <LinkText
        link={link}
        field="label"
        title={t("caseBoard.edgeDetails.label")}
        placeholder={t("caseBoard.link.labelPlaceholder")}
        readOnly={readOnly}
        onSave={(value, claim) => run({ label: value || null }, claim)}
      />
      <LinkText
        link={link}
        field="note"
        title={t("caseBoard.edgeDetails.note")}
        placeholder={t("caseBoard.edgeDetails.notePlaceholder")}
        readOnly={readOnly}
        multiline
        onSave={(value, claim) => run({ note: value || null }, claim)}
      />

      <div className="flex flex-wrap gap-2 border-t-2 border-border pt-3">
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          disabled={readOnly || !!link.promotedEdgeId || !ends.promotable}
          title={t("caseBoard.link.promoteHint")}
          onClick={() => {
            store.getState().run(promoteLink(link));
            toast.success(t("caseBoard.toasts.promoted"));
          }}
        >
          <Globe className="size-3" /> {link.promotedEdgeId ? t("caseBoard.link.promoted") : t("caseBoard.link.promote")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
          disabled={readOnly}
          onClick={() => {
            store.getState().run(deleteLinks([link]));
            ui.getState().set({ detailsTarget: null });
          }}
          data-testid="link-delete"
        >
          <Trash2 className="size-3" /> {t("caseBoard.link.delete")}
        </Button>
      </div>
    </div>
  );
}

/**
 * A link's label or note, saved when the field is left (or Enter, for the
 * label). It claims the version it was opened on, so a colleague's edit in
 * the meantime is refused rather than overwritten (claims.ts).
 */
function LinkText({
  link,
  field,
  title,
  placeholder,
  readOnly,
  multiline = false,
  onSave,
}: {
  link: BoardLink;
  field: "label" | "note";
  title: string;
  placeholder: string;
  readOnly: boolean;
  multiline?: boolean;
  onSave: (value: string, claim: string) => void;
}) {
  const stored = link[field] ?? "";
  const [draft, setDraft] = React.useState(stored);
  const began = React.useRef<{ text: string; updatedAt: string } | null>(null);
  const editing = began.current !== null;
  React.useEffect(() => {
    if (!editing) setDraft(stored);
  }, [stored, editing]);
  const save = () => {
    const from = began.current;
    began.current = null;
    const value = draft.trim();
    if (value === stored.trim()) return;
    onSave(value, textClaim(link, stored, from));
  };
  const props = {
    value: draft,
    placeholder,
    disabled: readOnly,
    onFocus: () => {
      began.current = { text: stored, updatedAt: link.updatedAt };
    },
    onBlur: save,
  };
  return (
    <Section title={title}>
      {multiline ? (
        <Textarea
          {...props}
          rows={3}
          className="text-xs"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
      ) : (
        <Input
          {...props}
          className="h-8 text-xs"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      )}
    </Section>
  );
}

// ─── A relation the platform found ────────────────────────────────────────────

const METHOD_KEYS = ["RUNTIME_OBSERVED", "SYSTEM_CATALOG", "SQL_PARSED", "HEURISTIC", "MANUAL"] as const;

function SystemEdgeDetails({ systemEdgeId, onFlyTo }: { systemEdgeId: string; onFlyTo: (nodeId: string) => void }) {
  const { t } = useTranslation();
  const store = useBoardStore();
  const ui = useUiStore();
  const readOnly = useBoard((s) => s.readOnly);
  const systemEdges = useBoard((s) => s.systemEdges);
  const edge = systemEdges.get(systemEdgeId);
  const rs = useRelationState();
  const view = React.useMemo(() => {
    if (!edge) return null;
    // Every relation between the same two things (the canvas folds them into one line).
    const siblings = [...systemEdges.values()].filter(
      (o) => o.id !== edge.id && ((o.from === edge.from && o.to === edge.to) || (o.from === edge.to && o.to === edge.from)),
    );
    return { from: graphEndView(rs, edge.from), to: graphEndView(rs, edge.to), siblings };
  }, [edge, systemEdges, rs]);
  if (!edge || !view) return <Gone />;
  const cls = edgeDrawClass(edge);
  const manual = edge.origin === "MANUAL";
  const method = (METHOD_KEYS as readonly string[]).includes(edge.method ?? "") ? edge.method! : null;
  const whatKey = manual ? "global" : cls === "IDENTITY" ? "duplicate" : cls === "FLOW" ? "lineage" : edge.relationClass === "USAGE" ? "usage" : "reference";
  const assets =
    edge.from.startsWith("asset:") && edge.to.startsWith("asset:") ? { a: edge.from.slice(6), b: edge.to.slice(6) } : null;

  // A global relationship is in every case's graph: removing it is confirmed, then the board rereads.
  const deleteEverywhere = () =>
    ui.getState().set({
      confirm: {
        title: t("caseBoard.link.deleteEverywhereTitle"),
        body: t("caseBoard.link.deleteEverywhereBody"),
        confirmLabel: t("caseBoard.link.deleteEverywhere"),
        destructive: true,
        onConfirm: async () => {
          try {
            await api.graph.graphControllerDeleteEdge({ id: systemEdgeId });
            ui.getState().set({ detailsTarget: null });
            store.getState().refetch();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : String(error));
          }
        },
      },
    });

  return (
    <div className="space-y-4 text-sm" data-testid="system-edge-details">
      <div className="space-y-1">
        <p className="flex items-center gap-1 font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
          {manual ? <Globe className="size-3" aria-hidden /> : <Lock className="size-3" aria-hidden />}
          {t(`caseBoard.edgeDetails.what.${whatKey}.title`)}
        </p>
        <p className="font-semibold">{humanizeKind(edge.relationType, t)}</p>
        <p className="text-xs text-muted-foreground">{t(`caseBoard.edgeDetails.what.${whatKey}.body`)}</p>
      </div>
      <Ends from={view.from} to={view.to} onFlyTo={onFlyTo} />

      <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">{t("caseBoard.edgeDetails.confidence")}</dt>
        <dd className="font-mono tabular-nums">{Math.round(edge.confidence * 100)}%</dd>
        <dt className="text-muted-foreground">{t("caseBoard.edgeDetails.foundBy")}</dt>
        <dd>
          {method ? t(`caseBoard.edgeDetails.methods.${method as (typeof METHOD_KEYS)[number]}`) : edge.method ?? "—"}
        </dd>
        {edge.granularity === "FIELD" && (
          <>
            <dt className="text-muted-foreground">{t("caseBoard.edgeDetails.granularity")}</dt>
            <dd>{t("caseBoard.edgeDetails.columnLevel")}</dd>
          </>
        )}
      </dl>

      {view.siblings.length > 0 && (
        <Section title={t("caseBoard.edgeDetails.alsoBetween", { count: view.siblings.length })}>
          <ul className="flex flex-wrap gap-1">
            {view.siblings.map((o) => (
              <li key={o.id} className="rounded-[3px] border border-border px-1.5 py-0.5 font-mono text-[10px]">
                {humanizeKind(o.relationType, t)} · {Math.round(o.confidence * 100)}%
              </li>
            ))}
          </ul>
        </Section>
      )}

      {cls === "IDENTITY" && assets && <DuplicatePair aId={assets.a} bId={assets.b} />}
      {cls === "FLOW" && <LineageEvidence edge={edge} />}
      {cls !== "FLOW" && cls !== "IDENTITY" && edge.evidence && Object.keys(edge.evidence).length > 0 && (
        <EvidenceBlock evidence={edge.evidence} />
      )}

      <div className="flex flex-wrap gap-2 border-t-2 border-border pt-3">
        {assets && (
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => openInTab(`/assets/${assets.a}?tab=lineage`)}>
            <ExternalLink className="size-3" /> {t("caseBoard.edgeDetails.openLineage")}
          </Button>
        )}
        {manual && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
            disabled={readOnly}
            onClick={deleteEverywhere}
          >
            <Trash2 className="size-3" /> {t("caseBoard.link.deleteEverywhere")}
          </Button>
        )}
      </div>
    </div>
  );
}

/** How strongly two assets match, and on what: the duplicate review's own breakdown. */
function DuplicatePair({ aId, bId }: { aId: string; bId: string }) {
  const { t } = useTranslation();
  const [pair, setPair] = React.useState<ReviewPairResponseDto | null>(null);
  const [state, setState] = React.useState<"loading" | "ready" | "missing">("loading");
  React.useEffect(() => {
    let active = true;
    setState("loading");
    api.correlationReview
      .correlationReviewControllerPair({ aId, bId })
      .then((p) => {
        if (!active) return;
        setPair(p);
        setState("ready");
      })
      .catch(() => {
        if (active) setState("missing");
      });
    return () => {
      active = false;
    };
  }, [aId, bId]);
  if (state === "loading") {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> {t("caseBoard.edgeDetails.loadingPair")}
      </p>
    );
  }
  if (!pair) return <p className="text-xs text-muted-foreground">{t("caseBoard.edgeDetails.noPair")}</p>;
  return (
    <div className="space-y-3" data-testid="duplicate-pair">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-2xl leading-none font-bold tabular-nums">{score2(pair.weighted)}</span>
        <span className="text-xs text-muted-foreground">{t("caseBoard.edgeDetails.matchScore")}</span>
        <span className="flex-1" />
        <LineageEvidenceChip
          state={pair.lineage.state}
          relation={pair.lineage.relation}
          aDegree={pair.lineage.aDegree}
          bDegree={pair.lineage.bDegree}
          compact
        />
      </div>
      {pair.verdict && (
        <p className="font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase">
          {t("review.pair.alreadyDecided", { verdict: pair.verdict })}
          {pair.verdictStale ? ` · ${t("review.pair.staleVerdict")}` : ""}
        </p>
      )}
      <MatchWeightWaterfall waterfall={pair.waterfall} />
      <details className="group rounded-[4px] border-2 border-border">
        <summary className="cursor-pointer px-2 py-1.5 font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
          {t("caseBoard.edgeDetails.sharedValues", { count: pair.fields.length })}
        </summary>
        <div className="overflow-x-auto p-2">
          <PairValuesTable fields={pair.fields} waterfall={pair.waterfall.rows} aName={pair.a.name} bName={pair.b.name} />
        </div>
      </details>
      <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => openInTab(`/duplicates/pairs/${encodePairId(aId, bId)}`)}>
        <ExternalLink className="size-3" /> {t("caseBoard.edgeDetails.openReview")}
      </Button>
    </div>
  );
}

/** What a lineage edge was read from, and the columns it carries. */
function LineageEvidence({ edge }: { edge: SystemEdge }) {
  const { t } = useTranslation();
  const mappings = edge.fieldMappings ?? [];
  return (
    <div className="space-y-3">
      {edge.evidence && Object.keys(edge.evidence).length > 0 && <EvidenceBlock evidence={edge.evidence} />}
      {mappings.length > 0 && (
        <Section title={t("caseBoard.edgeDetails.columns", { count: mappings.length })}>
          <ul className="max-h-56 space-y-0.5 overflow-y-auto font-mono text-[11px]">
            {mappings.slice(0, 100).map((m, index) => (
              <li key={index} className="flex min-w-0 items-baseline gap-1.5">
                <span className="truncate text-foreground">{m.downstream ?? t("caseBoard.edgeDetails.indirect")}</span>
                <span className="shrink-0 text-muted-foreground">←</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{m.upstreams.join(", ")}</span>
                {m.transform && <span className="shrink-0 rounded border border-border px-1 text-[9px] uppercase">{m.transform}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

/** The record an edge was derived from (a query, a run), as it came. */
function EvidenceBlock({ evidence }: { evidence: Record<string, unknown> }) {
  const { t } = useTranslation();
  const sql = typeof evidence.sql === "string" ? evidence.sql : null;
  const rest = Object.entries(evidence).filter(([key, value]) => key !== "sql" && value !== null && value !== undefined && value !== "");
  return (
    <Section title={t("caseBoard.edgeDetails.evidence")}>
      {sql && (
        <pre className="max-h-48 overflow-auto rounded-[4px] border-2 border-border bg-muted/40 p-2 font-mono text-[11px] whitespace-pre-wrap">
          {sql}
        </pre>
      )}
      {rest.length > 0 && (
        <dl className="grid grid-cols-[90px_1fr] gap-x-2 gap-y-0.5 text-[11px]">
          {rest.slice(0, 12).map(([key, value]) => (
            <React.Fragment key={key}>
              <dt className="truncate text-muted-foreground">{key}</dt>
              <dd className="truncate font-mono" title={typeof value === "string" ? value : JSON.stringify(value)}>
                {typeof value === "string" ? value : JSON.stringify(value)}
              </dd>
            </React.Fragment>
          ))}
        </dl>
      )}
    </Section>
  );
}

// ─── A stance on a hypothesis ─────────────────────────────────────────────────

const STANCES: Array<{ value: BoardStance; icon: typeof Check; color: string }> = [
  { value: "SUPPORTS", icon: Check, color: "var(--cb-supports)" },
  { value: "CONTRADICTS", icon: X, color: "var(--cb-contradicts)" },
  { value: "NEUTRAL", icon: Circle, color: "var(--cb-neutral)" },
];

function StanceDetails({ supportId, onFlyTo }: { supportId: string; onFlyTo: (nodeId: string) => void }) {
  const { t } = useTranslation();
  const store = useBoardStore();
  const ui = useUiStore();
  const readOnly = useBoard((s) => s.readOnly);
  const support = useBoard((s) => s.supports.get(supportId));
  const rs = useRelationState();
  const threads = rs.threads;
  const thread = support ? threads.get(support.threadId) : undefined;
  const ends = React.useMemo(() => {
    if (!support?.endpoint || !thread?.itemId) return null;
    return {
      hypothesis: itemEndView(rs, thread.itemId, null),
      evidence: itemEndView(rs, support.endpoint.itemId, support.endpoint.findingId),
    };
  }, [support, thread, rs]);
  if (!support?.endpoint || !thread?.itemId || !ends) return <Gone />;
  const meta = hypothesisMeta(threads).get(thread.id);
  const endpoint = {
    itemId: support.endpoint.itemId,
    ...(support.endpoint.findingId ? { findingId: support.endpoint.findingId } : {}),
  };
  const words: Record<BoardStance, string> = {
    SUPPORTS: t("caseBoard.link.supports"),
    CONTRADICTS: t("caseBoard.link.contradicts"),
    NEUTRAL: t("caseBoard.link.neutral"),
  };

  return (
    <div className="space-y-4 text-sm" data-testid="stance-details">
      <div className="space-y-1">
        <p className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
          <FlaskConical className="size-3" aria-hidden /> {t("caseBoard.edgeDetails.stance")}
        </p>
        <button
          type="button"
          className="flex max-w-full items-center gap-2 text-left font-semibold hover:underline"
          onClick={() => ui.getState().openDrawer("thread", { threadId: thread.id })}
        >
          {meta && (
            <span className="shrink-0 rounded-[3px] px-1.5 py-0.5 font-mono text-[10px] leading-none text-white" style={{ background: meta.color }}>
              {meta.label}
            </span>
          )}
          <span className="truncate">{thread.title}</span>
        </button>
      </div>
      <Ends from={ends.evidence} to={ends.hypothesis} onFlyTo={onFlyTo} />
      <Section title={t("caseBoard.edgeDetails.bearing")}>
        <div className="grid grid-cols-3 gap-1">
          {STANCES.map(({ value, icon: Icon, color }) => (
            <button
              key={value}
              type="button"
              disabled={readOnly || support.pending}
              aria-pressed={support.stance === value}
              onClick={() => support.stance !== value && store.getState().run(setStance(thread.itemId!, endpoint, value, support))}
              className={cn(
                "flex flex-col items-center gap-1 rounded-[4px] border-2 px-1 py-2 text-[11px] font-medium disabled:opacity-60",
                support.stance === value ? "border-foreground" : "border-border hover:border-foreground/40",
              )}
            >
              <Icon className="size-4" style={{ color }} strokeWidth={3} aria-hidden />
              {words[value]}
            </button>
          ))}
        </div>
      </Section>
      {(support.weight !== null || support.note) && (
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-xs">
          {support.weight !== null && (
            <>
              <dt className="text-muted-foreground">{t("caseBoard.link.confidence")}</dt>
              <dd className="font-mono">{support.weight.toFixed(2)}</dd>
            </>
          )}
          {support.note && (
            <>
              <dt className="text-muted-foreground">{t("caseBoard.edgeDetails.note")}</dt>
              <dd className="whitespace-pre-wrap">{support.note}</dd>
            </>
          )}
        </dl>
      )}
      <div className="flex flex-wrap gap-2 border-t-2 border-border pt-3">
        <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => ui.getState().openDrawer("thread", { threadId: thread.id })}>
          <FlaskConical className="size-3" /> {t("caseBoard.hypothesis.openThread")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
          disabled={readOnly || support.pending}
          onClick={() => {
            store.getState().run(removeStance(thread.itemId!, endpoint, support));
            ui.getState().set({ detailsTarget: null });
          }}
        >
          <Trash2 className="size-3" /> {t("caseBoard.menu.removeStance")}
        </Button>
      </div>
    </div>
  );
}
