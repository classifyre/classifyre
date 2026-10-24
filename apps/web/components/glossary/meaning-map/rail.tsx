"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  ChevronRight,
  Eye,
  FileSearch,
  FolderPlus,
  Inbox,
  ListTree,
  Pencil,
  Link2,
  Loader2,
  Plus,
  RotateCw,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { FINDING_SEVERITY_COLOR_BY_ENUM } from "@workspace/ui/lib/finding-severity";
import { cn } from "@workspace/ui/lib/utils";
import { assetCandidate, useAddToCase } from "@/components/case-target/case-target";
import { microLabelClass } from "@/components/panel-card";
import { useTermHref } from "@/components/glossary/glossary-ui";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { formatRelative } from "@/lib/date";
import type { SchemeFrame } from "@/lib/meaning-map-layout";
import { useNsPath } from "@/lib/ns-path";
import {
  getMapTermRail,
  getTerm,
  getTermEvidence,
  removeRelation,
  semanticErrorMessage,
  type TermDetail,
  type MapLink,
  type MapNode,
  type MapTermRail,
  type SemanticMap,
  type TermEvidencePage,
} from "@/lib/semantic-api";
import { FALLBACK_SCHEME_COLOR } from "./nodes";

const EVIDENCE_SHOWN = 6;

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-[4px] border-2 border-border px-2 py-1.5">
      <div className={microLabelClass}>{label}</div>
      <div className="font-mono text-lg font-bold tabular-nums leading-tight">
        {value === null ? "–" : value.toLocaleString()}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5 border-t border-border/60 pt-3">
      <h5 className={microLabelClass}>{title}</h5>
      {children}
    </section>
  );
}

/** A concept named in the rail; clicking it moves the selection there. */
function ConceptChip({
  node,
  onSelect,
  trailing,
}: {
  node: MapNode;
  onSelect: (termId: string) => void;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(node.termId)}
      className="flex w-full items-center gap-2 rounded-[3px] px-1.5 py-1 text-left text-xs hover:bg-muted/60"
    >
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-[2px]"
        style={{ backgroundColor: node.scheme?.color ?? FALLBACK_SCHEME_COLOR }}
      />
      <span className="min-w-0 flex-1 truncate font-medium">{node.name}</span>
      {trailing}
    </button>
  );
}

function LineSample({ dash, width = 1.5 }: { dash?: string; width?: number }) {
  return (
    <svg width="28" height="8" aria-hidden className="shrink-0">
      <line
        x1="1"
        y1="4"
        x2="27"
        y2="4"
        stroke="currentColor"
        strokeWidth={width}
        strokeDasharray={dash}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** With nothing selected: what is drawn, how to read it, and how fresh it is. */
function Legend({
  map,
  frames,
  onFocusFrame,
  onRebuild,
  rebuilding,
  onClose,
}: {
  map: SemanticMap;
  frames: SchemeFrame[];
  onFocusFrame: (frameId: string) => void;
  onRebuild: () => void;
  rebuilding: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  return (
    <div className="space-y-3" data-testid="meaning-rail-legend">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-serif text-base font-black uppercase tracking-[0.04em]">
          {t("semanticMap.rail.howToRead")}
        </h4>
        <button
          type="button"
          aria-label={t("common.close")}
          onClick={onClose}
          className="rounded-[2px] p-0.5 hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <section className="space-y-1.5">
        <h5 className={microLabelClass}>{t("semanticMap.rail.schemes")}</h5>
        <ul className="space-y-0.5">
          {frames.map((frame) => (
            <li key={frame.id}>
              <button
                type="button"
                onClick={() => onFocusFrame(frame.id)}
                className="flex w-full items-center gap-2 rounded-[3px] px-1.5 py-1 text-left text-xs hover:bg-muted/60"
              >
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: frame.scheme?.color ?? FALLBACK_SCHEME_COLOR }}
                />
                <span className="min-w-0 flex-1 truncate">
                  {frame.scheme?.name ?? t("semanticMap.noScheme")}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {frame.conceptIds.length}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <Section title={t("semanticMap.rail.lines")}>
        <ul className="space-y-1 text-xs text-muted-foreground">
          <li className="flex items-center gap-2">
            <LineSample />
            {t("semanticMap.rail.lineBroader")}
          </li>
          <li className="flex items-center gap-2">
            <LineSample dash="7 5" />
            {t("semanticMap.rail.lineRelated")}
          </li>
          <li className="flex items-center gap-2">
            <LineSample dash="1 5" width={2.5} />
            {t("semanticMap.rail.lineTogether")}
          </li>
        </ul>
      </Section>
      <Section title={t("semanticMap.rail.cards")}>
        <p className="text-xs leading-relaxed text-muted-foreground">{t("semanticMap.rail.cardsHint")}</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((level) => (
            <span key={level} className="flex items-center gap-1 font-mono text-[10px] uppercase text-muted-foreground">
              <span aria-hidden className="h-1.5 w-3 rounded-[1px]" style={{ backgroundColor: FINDING_SEVERITY_COLOR_BY_ENUM[level] }} />
              {t(`findings.severityLabels.${level}` as TranslationKey)}
            </span>
          ))}
        </div>
      </Section>
      <Section title={t("semanticMap.rail.freshness")}>
        {map.coverage && (
          <p className="text-xs">
            {t("semanticMap.rail.coverage", {
              share: `${Math.round(map.coverage.share * 100)}%`,
              findings: map.coverage.openFindings.toLocaleString(),
            })}
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            {map.freshness.refreshedAt
              ? t("semanticMap.rail.built", { when: formatRelative(map.freshness.refreshedAt) })
              : t("semanticMap.rail.notBuilt")}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={rebuilding}
            onClick={onRebuild}
            className="h-7 rounded-[4px] border-2 border-border px-2 font-mono text-[10px] uppercase tracking-[0.1em]"
          >
            {rebuilding ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}
            {t("semanticMap.rebuild")}
          </Button>
        </div>
        {map.unbound.outputs > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("semanticMap.unbound", {
              outputs: map.unbound.outputs.toLocaleString(),
              findings: map.unbound.findings.toLocaleString(),
            })}{" "}
            <Link href={nsPath("/glossary?tab=vocabulary")} className="text-foreground underline">
              {t("semanticMap.review")}
            </Link>
          </p>
        )}
      </Section>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{t("semanticMap.rail.hint")}</p>
    </div>
  );
}

/** One concept: what it is, how much stands behind it, and what to do with it. */
function ConceptDetail({
  concept,
  nodesById,
  links,
  caseId,
  onSelect,
  onClose,
  onAddToCase,
  shareUrl,
  editing,
}: {
  concept: MapNode;
  nodesById: Map<string, MapNode>;
  links: MapLink[];
  caseId: string | null;
  onSelect: (termId: string) => void;
  onClose: () => void;
  onAddToCase: (concept: MapNode) => void;
  shareUrl: string;
  editing: RailEditing | null;
}) {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  const termHref = useTermHref();
  const { target: caseTarget, dialog: caseDialog } = useAddToCase();
  const [rail, setRail] = React.useState<MapTermRail | null>(null);
  const [evidence, setEvidence] = React.useState<TermEvidencePage | null>(null);
  const [detail, setDetail] = React.useState<TermDetail | null>(null);

  const narrower = React.useMemo(
    () =>
      [...nodesById.values()]
        .filter((node) => node.broaderIds.includes(concept.termId))
        .sort((a, b) => b.totalAssetCount - a.totalAssetCount),
    [nodesById, concept.termId],
  );
  const broader = concept.broaderIds
    .map((id) => nodesById.get(id))
    .filter((node): node is MapNode => !!node);
  const together = links
    .filter((link) => link.kind === "CO_OCCURRENCE")
    .filter((link) => link.a === concept.termId || link.b === concept.termId)
    .map((link) => ({ link, node: nodesById.get(link.a === concept.termId ? link.b : link.a) }))
    .filter((entry): entry is { link: MapLink; node: MapNode } => !!entry.node)
    .sort((a, b) => (b.link.lift ?? 0) - (a.link.lift ?? 0));

  React.useEffect(() => {
    let active = true;
    setRail(null);
    setEvidence(null);
    getMapTermRail(concept.termId)
      .then((result) => active && setRail(result))
      .catch(() => undefined);
    getTermEvidence(concept.termId, { includeNarrower: narrower.length > 0, page: 1 })
      .then((result) => active && setEvidence(result))
      .catch(() => active && setEvidence({ termId: concept.termId, includeNarrower: false, total: 0, page: 1, pageSize: 0, assets: [] }));
    return () => {
      active = false;
    };
  }, [concept.termId, narrower.length]);

  // The concept's own relations, with their ids: re-read whenever the map is.
  React.useEffect(() => {
    let active = true;
    getTerm(concept.key)
      .then((result) => active && setDetail(result))
      .catch(() => active && setDetail(null));
    return () => {
      active = false;
    };
  }, [concept.key, links]);

  const unrelate = async (relationId: string) => {
    try {
      await removeRelation(relationId);
      toast.success(t("semanticMap.edit.unrelated"));
      editing?.onChanged();
    } catch (error) {
      toast.error(semanticErrorMessage(error, t("glossary.actionFailed")));
    }
  };

  const sourceMax = Math.max(1, ...(rail?.bySource.map((row) => row.assets) ?? [1]));
  const watchHref = nsPath(
    `/investigations/inquiries/new?term=${encodeURIComponent(concept.key)}${caseId ? `&caseId=${encodeURIComponent(caseId)}` : ""}`,
  );

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success(t("semanticMap.rail.linkCopied"));
    } catch {
      toast.error(t("semanticMap.rail.linkCopyFailed"));
    }
  };

  return (
    <div className="space-y-3" data-testid="meaning-rail-concept">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <nav className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
            <span
              aria-hidden
              className="size-2 rounded-[2px]"
              style={{ backgroundColor: concept.scheme?.color ?? FALLBACK_SCHEME_COLOR }}
            />
            <span>{concept.scheme?.name ?? t("semanticMap.noScheme")}</span>
            {broader.map((node) => (
              <React.Fragment key={node.termId}>
                <ChevronRight className="h-3 w-3" />
                <button type="button" onClick={() => onSelect(node.termId)} className="hover:text-foreground hover:underline">
                  {node.name}
                </button>
              </React.Fragment>
            ))}
          </nav>
          <h4 className="font-serif text-lg font-black leading-tight">{concept.name}</h4>
        </div>
        <button
          type="button"
          aria-label={t("common.close")}
          onClick={onClose}
          className="rounded-[2px] p-0.5 hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {(rail?.term.definition ?? concept.definition) && (
        <p className="line-clamp-5 text-xs leading-relaxed text-muted-foreground">
          {rail?.term.definition ?? concept.definition}
        </p>
      )}

      <div className="grid grid-cols-3 gap-1.5">
        <Stat label={t("glossary.evidence.assets")} value={concept.totalAssetCount} />
        <Stat label={t("glossary.evidence.findings")} value={concept.findingCount} />
        <Stat label={t("glossary.evidence.sources")} value={concept.sourceCount} />
      </div>

      {editing && (
        <div className="grid grid-cols-3 gap-1.5">
          {(
            [
              [Pencil, "semanticMap.edit.edit", () => editing.onEdit(concept), "meaning-edit"],
              [ListTree, "semanticMap.edit.addNarrower", () => editing.onAddNarrower(concept), "meaning-add-narrower"],
              [ArrowLeftRight, "semanticMap.edit.relate", () => editing.onRelate(concept), "meaning-relate"],
            ] as const
          ).map(([Icon, label, onClick, testId]) => (
            <Button
              key={label}
              size="sm"
              variant="outline"
              onClick={onClick}
              className="h-8 rounded-[4px] border-2 border-border px-1.5 text-[11px]"
              data-testid={testId}
            >
              <Icon className="h-3.5 w-3.5" />
              {t(label)}
            </Button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-1.5">
        <Button asChild size="sm" className="col-span-2 h-8 rounded-[4px]">
          <Link href={termHref(concept.key)}>{t("semanticMap.openTerm")}</Link>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onAddToCase(concept)}
          className="h-8 rounded-[4px] border-2 border-border text-xs"
          data-testid="meaning-add-to-case"
        >
          <FolderPlus className="h-3.5 w-3.5" />
          {t("semanticMap.rail.addToCase")}
        </Button>
        <Button asChild size="sm" variant="outline" className="h-8 rounded-[4px] border-2 border-border text-xs">
          <Link href={watchHref}>
            <Eye className="h-3.5 w-3.5" />
            {t("semanticMap.rail.watch")}
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline" className="h-8 rounded-[4px] border-2 border-border text-xs">
          <Link href={`${termHref(concept.key)}?tab=evidence`}>
            <FileSearch className="h-3.5 w-3.5" />
            {t("semanticMap.rail.evidence")}
          </Link>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void copyLink()}
          className="h-8 rounded-[4px] border-2 border-border text-xs"
        >
          <Link2 className="h-3.5 w-3.5" />
          {t("semanticMap.rail.copyLink")}
        </Button>
        {concept.pendingProposals > 0 && (
          <Button asChild size="sm" variant="outline" className="col-span-2 h-8 rounded-[4px] border-2 border-amber-500/60 text-xs">
            <Link href={nsPath("/glossary?tab=proposals")}>
              <Inbox className="h-3.5 w-3.5" />
              {t("semanticMap.rail.reviewProposals", { count: String(concept.pendingProposals) })}
            </Link>
          </Button>
        )}
      </div>

      {together.length > 0 && (
        <Section title={t("semanticMap.rail.together")}>
          <div className="space-y-0.5">
            {together.map(({ link, node }) => (
              <ConceptChip
                key={node.termId}
                node={node}
                onSelect={onSelect}
                trailing={
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {t("semanticMap.rail.togetherCount", {
                      count: link.assetCount.toLocaleString(),
                      lift: link.lift === null ? "–" : link.lift.toFixed(1),
                    })}
                  </span>
                }
              />
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">{t("semanticMap.rail.togetherHint")}</p>
        </Section>
      )}

      {detail && detail.relations.length > 0 && (
        <Section title={t("semanticMap.rail.related")}>
          <ul className="space-y-0.5">
            {detail.relations.map((relation) => {
              const onMap = nodesById.get(relation.term.id);
              const verb =
                relation.type === "CUSTOM" && relation.label
                  ? relation.label
                  : t(`glossary.relations.${relation.direction}.${relation.type}` as TranslationKey);
              return (
                <li key={relation.id} className="group flex items-center gap-1">
                  <span className="w-[86px] shrink-0 truncate font-mono text-[10px] text-muted-foreground" title={verb}>
                    {verb}
                  </span>
                  {onMap ? (
                    <ConceptChip node={onMap} onSelect={onSelect} />
                  ) : (
                    <Link href={termHref(relation.term.key)} className="min-w-0 flex-1 truncate px-1.5 py-1 text-xs hover:underline">
                      {relation.term.term}
                    </Link>
                  )}
                  {editing && (
                    <button
                      type="button"
                      onClick={() => void unrelate(relation.id)}
                      aria-label={t("glossary.relations.remove")}
                      title={t("glossary.relations.remove")}
                      className="shrink-0 rounded-[3px] p-0.5 text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {rail && rail.bySource.length > 0 && (
        <Section title={t("semanticMap.rail.bySource")}>
          <ul className="space-y-1">
            {rail.bySource.map((row) => (
              <li key={row.sourceId} className="space-y-0.5">
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <Link href={nsPath(`/sources/${row.sourceId}`)} className="min-w-0 truncate hover:underline">
                    {row.name}
                  </Link>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{row.assets.toLocaleString()}</span>
                </div>
                <div className="h-1 overflow-hidden rounded-[1px] bg-muted">
                  <div
                    className="h-full"
                    style={{
                      width: `${(row.assets / sourceMax) * 100}%`,
                      backgroundColor: concept.scheme?.color ?? FALLBACK_SCHEME_COLOR,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={t("semanticMap.rail.topEvidence")}>
        {evidence === null ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : evidence.assets.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("semanticMap.rail.noEvidence")}</p>
        ) : (
          <ul className="space-y-0.5">
            {evidence.assets.slice(0, EVIDENCE_SHOWN).map((asset) => {
              const severity = asset.maxSeverity?.toUpperCase() as keyof typeof FINDING_SEVERITY_COLOR_BY_ENUM | undefined;
              const status = caseTarget.status(assetCandidate({ id: asset.assetId, name: asset.assetName }));
              return (
                <li key={asset.assetId} className="group flex items-center gap-2 rounded-[3px] px-1.5 py-1 hover:bg-muted/60">
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        severity && severity in FINDING_SEVERITY_COLOR_BY_ENUM
                          ? FINDING_SEVERITY_COLOR_BY_ENUM[severity]
                          : "var(--muted-foreground)",
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <Link
                      href={nsPath(`/assets/${asset.assetId}`)}
                      className="block truncate text-xs font-medium hover:underline"
                      title={asset.assetName}
                    >
                      {asset.assetName}
                    </Link>
                    <span className="block truncate text-[10px] text-muted-foreground">{asset.source.name}</span>
                  </span>
                  <button
                    type="button"
                    disabled={status === "inCase" || caseTarget.readOnly}
                    onClick={() =>
                      caseTarget.add([
                        assetCandidate({ id: asset.assetId, name: asset.assetName, assetType: asset.assetType }),
                      ])
                    }
                    title={t("caseTarget.menu.addToCase")}
                    aria-label={t("caseTarget.menu.addToCase")}
                    className={cn(
                      "shrink-0 rounded-[3px] border border-border p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100 focus-visible:opacity-100",
                      status === "inCase" && "hidden",
                    )}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {evidence && evidence.total > 0 && (
          <Link
            href={`${termHref(concept.key)}?tab=evidence`}
            className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground"
          >
            {t("semanticMap.rail.allEvidence", { count: evidence.total.toLocaleString() })}
            <ChevronRight className="h-3 w-3" />
          </Link>
        )}
      </Section>
      {caseDialog}
    </div>
  );
}

/** What the rail can change about a concept, when the map is editable. */
export interface RailEditing {
  onEdit: (concept: MapNode) => void;
  onAddNarrower: (concept: MapNode) => void;
  onRelate: (concept: MapNode) => void;
  /** Something about the glossary changed: redraw. */
  onChanged: () => void;
}

/** The rail's width; the map centres a selected concept beside it. */
export const MEANING_RAIL_WIDTH = 320;

/**
 * The panel over the right edge of the semantic map (SL5 B3), in the pattern
 * of the connections rail: a concept's detail and actions once one is
 * selected, otherwise the legend when asked for. It floats over the map so
 * the map keeps the whole width while nothing is open.
 */
export function MeaningMapRail({
  map,
  frames,
  selected,
  nodesById,
  caseId,
  onSelect,
  onFocusFrame,
  onAddToCase,
  onRebuild,
  rebuilding,
  shareUrl,
  onCloseLegend,
  editing = null,
}: {
  map: SemanticMap;
  frames: SchemeFrame[];
  selected: MapNode | null;
  nodesById: Map<string, MapNode>;
  caseId: string | null;
  onSelect: (termId: string | null) => void;
  onFocusFrame: (frameId: string) => void;
  onAddToCase: (concept: MapNode) => void;
  onRebuild: () => void;
  rebuilding: boolean;
  shareUrl: string;
  onCloseLegend: () => void;
  /** Present when the map may change the glossary. */
  editing?: RailEditing | null;
}) {
  return (
    <aside
      className="absolute inset-y-0 right-0 z-20 max-w-full overflow-y-auto border-l-2 border-border bg-card p-3 shadow-[-12px_0_24px_-16px_rgba(0,0,0,0.6)]"
      style={{ width: MEANING_RAIL_WIDTH }}
      data-testid="meaning-rail"
    >
      {selected ? (
        <ConceptDetail
          concept={selected}
          nodesById={nodesById}
          links={map.links}
          caseId={caseId}
          onSelect={(termId) => onSelect(termId)}
          onClose={() => onSelect(null)}
          onAddToCase={onAddToCase}
          shareUrl={shareUrl}
          editing={editing}
        />
      ) : (
        <Legend
          map={map}
          frames={frames}
          onFocusFrame={onFocusFrame}
          onRebuild={onRebuild}
          rebuilding={rebuilding}
          onClose={onCloseLegend}
        />
      )}
    </aside>
  );
}
