"use client";

import * as React from "react";
import { AlertTriangle, ArrowRight, Crosshair, ExternalLink, GripVertical, ListChecks, Loader2, Plus } from "lucide-react";
import {
  QuickSearchRequestDtoKindsEnum,
  type QuickSearchAssetDto,
  type QuickSearchFindingDto,
  type QuickSearchRequestDto,
} from "@workspace/api-client";
import { SeverityBadge } from "@workspace/ui/components/severity-badge";
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group";
import { FINDING_SEVERITY_COLOR_BY_ENUM } from "@workspace/ui/lib/finding-severity";
import { cn } from "@workspace/ui/lib/utils";
import { ALL_SOURCES, AssetFilterBar, useSourceOptions } from "@/components/asset-filter-bar";
import { getAssetKindIcon } from "@/lib/asset-kind";
import { nsPath } from "@/lib/ns-path";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard, useUi, useUiStore } from "../store/board-context";
import type { SeverityKey } from "../store/types";
import { BOARD_DRAG_MIME } from "../board-canvas";
import { useQuickSearch } from "../hooks/use-quick-search";
import {
  evidenceStatus,
  usePlaceEvidence,
  type EvidenceCandidate,
  type EvidenceStatus,
} from "../hooks/use-place-evidence";

type KindFilter = "both" | "assets" | "findings";

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const;

const assetCandidate = (a: QuickSearchAssetDto): EvidenceCandidate => ({
  kind: "asset",
  id: a.id,
  assetId: a.id,
  assetName: a.name,
  assetType: a.assetType,
  sourceType: a.sourceType,
});

const findingCandidate = (f: QuickSearchFindingDto): EvidenceCandidate => ({
  kind: "finding",
  id: f.id,
  assetId: f.assetId,
  assetName: f.assetName ?? f.findingType,
  assetType: null,
  sourceType: null,
});

/** Drag a result onto the canvas to drop it exactly there (the canvas's own drop target). */
function dragPayload(c: EvidenceCandidate) {
  return (event: React.DragEvent) => {
    event.dataTransfer.setData(
      BOARD_DRAG_MIME,
      JSON.stringify({
        entityType: c.kind,
        entityId: c.id,
        assetId: c.assetId,
        label: c.assetName,
        assetType: c.assetType,
        sourceType: c.sourceType,
      }),
    );
    event.dataTransfer.effectAllowed = "copy";
  };
}

/**
 * "Add evidence" in the side panel: the corpus search with the filters of the
 * assets table (one shared filter bar), over the cheap search-as-you-type
 * endpoint. Click a result to add it near the middle of the view, or drag it
 * to the spot it belongs.
 */
export function AddEvidencePanel({ onFlyTo }: { onFlyTo: (nodeId: string) => void }) {
  const { t } = useTranslation();
  const ui = useUiStore();
  const readOnly = useBoard((s) => s.readOnly);
  const caseId = useBoard((s) => s.caseId);
  const itemByAsset = useBoard((s) => s.itemByAsset);
  const bubbles = useBoard((s) => s.bubbles);
  const prefill = useUi((s) => s.addEvidenceQuery);
  const sources = useSourceOptions();
  const place = usePlaceEvidence(onFlyTo);

  const [search, setSearch] = React.useState(prefill);
  const [sourceId, setSourceId] = React.useState(ALL_SOURCES);
  const [severities, setSeverities] = React.useState<string[]>([]);
  const [detectorTypes, setDetectorTypes] = React.useState<string[]>([]);
  const [kind, setKind] = React.useState<KindFilter>("both");

  // The palette hands its query over once; after that the box is the panel's own.
  React.useEffect(() => {
    if (prefill) {
      setSearch(prefill);
      ui.getState().set({ addEvidenceQuery: "" });
    }
  }, [prefill, ui]);

  const request: Omit<QuickSearchRequestDto, "q"> & { q: string } = {
    q: search,
    limit: 15,
    ...(kind !== "both"
      ? {
          kinds: [kind === "assets" ? QuickSearchRequestDtoKindsEnum.Assets : QuickSearchRequestDtoKindsEnum.Findings],
        }
      : {}),
    ...(sourceId !== ALL_SOURCES ? { sourceId } : {}),
    ...(severities.length > 0 ? { severity: severities as QuickSearchRequestDto["severity"] } : {}),
    ...(detectorTypes.length > 0 ? { detectorType: detectorTypes as QuickSearchRequestDto["detectorType"] } : {}),
  };
  const result = useQuickSearch(request, !readOnly);
  const statusOf = (c: EvidenceCandidate) => evidenceStatus({ itemByAsset, bubbles }, c);
  const idle = search.trim().length < 2;
  const empty = !idle && !result.loading && !result.error && result.assets.length === 0 && result.findings.length === 0;

  return (
    <div className="space-y-4" data-testid="add-evidence-panel">
      <AssetFilterBar
        compact
        autoFocus
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("caseBoard.addEvidence.placeholder")}
        sources={sources}
        sourceId={sourceId}
        onSourceChange={setSourceId}
        severities={severities}
        onSeveritiesChange={setSeverities}
        detectorTypes={detectorTypes}
        onDetectorTypesChange={setDetectorTypes}
        afterSearch={
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={kind}
            onValueChange={(value) => value && setKind(value as KindFilter)}
            className="w-full"
            aria-label={t("caseBoard.addEvidence.kind")}
          >
            <ToggleGroupItem value="both" className="flex-1 text-xs">
              {t("caseBoard.addEvidence.both")}
            </ToggleGroupItem>
            <ToggleGroupItem value="assets" className="flex-1 text-xs">
              {t("caseBoard.addEvidence.assets")}
            </ToggleGroupItem>
            <ToggleGroupItem value="findings" className="flex-1 text-xs">
              {t("caseBoard.addEvidence.findings")}
            </ToggleGroupItem>
          </ToggleGroup>
        }
      />

      <div className="min-h-5 text-xs text-muted-foreground" aria-live="polite">
        {idle ? (
          <p>{t("caseBoard.addEvidence.hint")}</p>
        ) : result.loading ? (
          <p className="inline-flex items-center gap-1.5">
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> {t("caseBoard.palette.searching")}
          </p>
        ) : result.error ? (
          <p className="text-destructive">{result.error}</p>
        ) : result.truncated ? (
          <p className="inline-flex items-start gap-1.5" data-testid="add-evidence-truncated">
            <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden /> {t("caseBoard.addEvidence.truncated")}
          </p>
        ) : empty ? (
          <p>{t("caseBoard.palette.noResults")}</p>
        ) : (
          <p>{t("caseBoard.addEvidence.dragHint")}</p>
        )}
      </div>

      {result.assets.length > 0 && (
        <ResultSection title={t("caseBoard.addEvidence.assets")} count={result.assets.length}>
          {result.assets.map((a) => {
            const c = assetCandidate(a);
            return (
              <AssetResult
                key={a.id}
                asset={a}
                status={statusOf(c)}
                readOnly={readOnly}
                onPlace={() => place(c)}
                onDragStart={dragPayload(c)}
              />
            );
          })}
        </ResultSection>
      )}

      {result.findings.length > 0 && (
        <ResultSection title={t("caseBoard.addEvidence.findings")} count={result.findings.length}>
          {result.findings.map((f) => {
            const c = findingCandidate(f);
            return (
              <FindingResult
                key={f.id}
                finding={f}
                status={statusOf(c)}
                readOnly={readOnly}
                onPlace={() => place(c)}
                onDragStart={dragPayload(c)}
              />
            );
          })}
        </ResultSection>
      )}
      {!readOnly && (
        <a
          href={nsPath(`/investigations/${caseId}/evidence/add`)}
          className="flex items-center gap-2 rounded-[4px] border-2 border-dashed border-border px-3 py-2 text-xs text-muted-foreground hover:border-foreground/50 hover:text-foreground"
          data-testid="add-evidence-bulk"
        >
          <ListChecks className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">{t("caseBoard.addEvidence.bulk")}</span>
          <ArrowRight className="size-3.5 shrink-0" aria-hidden />
        </a>
      )}
    </div>
  );
}

function ResultSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {title} · {count}
      </p>
      <ul className="space-y-1">{children}</ul>
    </section>
  );
}

/** The one action a result offers, worded by where it stands against the board. */
function PlaceButton({
  status,
  readOnly,
  onPlace,
  testId,
}: {
  status: EvidenceStatus;
  readOnly: boolean;
  onPlace: () => void;
  testId: string;
}) {
  const { t } = useTranslation();
  const onBoard = status === "onBoard";
  return (
    <button
      type="button"
      onClick={onPlace}
      disabled={readOnly && !onBoard}
      data-testid={testId}
      data-status={status}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1 rounded-[4px] border-2 px-2 font-mono text-[10px] font-bold uppercase tracking-[0.06em] transition-colors disabled:opacity-40",
        onBoard
          ? "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          : "border-foreground bg-foreground text-background hover:bg-foreground/85",
      )}
    >
      {onBoard ? <Crosshair className="size-3" aria-hidden /> : <Plus className="size-3" strokeWidth={3} aria-hidden />}
      {onBoard
        ? t("caseBoard.drawers.onBoard")
        : status === "attachable"
          ? t("caseBoard.bubble.attach")
          : t("caseBoard.addEvidence.add")}
    </button>
  );
}

function AssetResult({
  asset,
  status,
  readOnly,
  onPlace,
  onDragStart,
}: {
  asset: QuickSearchAssetDto;
  status: EvidenceStatus;
  readOnly: boolean;
  onPlace: () => void;
  onDragStart: (event: React.DragEvent) => void;
}) {
  const { t } = useTranslation();
  const Icon = getAssetKindIcon(asset.assetType);
  const counts = asset.severityCounts;
  return (
    <li
      className="group flex items-center gap-2 rounded-[4px] border-2 border-border bg-card py-1.5 pl-1 pr-1.5"
      draggable={!readOnly && status === "absent"}
      onDragStart={onDragStart}
      data-testid="add-evidence-asset"
    >
      <GripVertical
        className={cn("size-3.5 shrink-0 text-muted-foreground/50", (readOnly || status !== "absent") && "invisible")}
        aria-hidden
      />
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={asset.name}>
          {asset.name}
        </p>
        <p className="flex items-center gap-2 truncate font-mono text-[10px] text-muted-foreground">
          <span className="truncate">{asset.sourceName ?? asset.sourceType}</span>
          {asset.openFindings > 0 ? (
            <span className="inline-flex shrink-0 items-center gap-1" title={
                asset.openFindings === 1
                  ? t("caseBoard.addEvidence.openFindingsOne")
                  : t("caseBoard.addEvidence.openFindings", { count: asset.openFindings })
              }>
              {SEVERITIES.map((sev) => {
                const n = counts[sev.toLowerCase() as keyof typeof counts];
                return n > 0 ? (
                  <span key={sev} className="inline-flex items-center gap-0.5">
                    <span className="size-2 rounded-[2px]" style={{ background: FINDING_SEVERITY_COLOR_BY_ENUM[sev] }} aria-hidden />
                    {n}
                  </span>
                ) : null;
              })}
            </span>
          ) : (
            <span className="shrink-0">{t("caseBoard.addEvidence.noOpenFindings")}</span>
          )}
        </p>
      </div>
      <a
        href={nsPath(`/assets/${asset.id}`)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
        title={t("caseBoard.menu.openAsset")}
        aria-label={t("caseBoard.menu.openAsset")}
      >
        <ExternalLink className="size-3.5" aria-hidden />
      </a>
      <PlaceButton status={status} readOnly={readOnly} onPlace={onPlace} testId="add-evidence-place-asset" />
    </li>
  );
}

function FindingResult({
  finding,
  status,
  readOnly,
  onPlace,
  onDragStart,
}: {
  finding: QuickSearchFindingDto;
  status: EvidenceStatus;
  readOnly: boolean;
  onPlace: () => void;
  onDragStart: (event: React.DragEvent) => void;
}) {
  const { t } = useTranslation();
  const severity = finding.severity.toLowerCase() as SeverityKey;
  return (
    <li
      className="group flex items-start gap-2 rounded-[4px] border-2 border-border bg-card py-1.5 pl-1 pr-1.5"
      draggable={!readOnly && status === "absent"}
      onDragStart={onDragStart}
      data-testid="add-evidence-finding"
    >
      <GripVertical
        className={cn("mt-1 size-3.5 shrink-0 text-muted-foreground/50", (readOnly || status !== "absent") && "invisible")}
        aria-hidden
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <SeverityBadge severity={severity} className="shrink-0 px-1 py-px text-[9px]">
            {t(`caseBoard.severity.${severity}`)}
          </SeverityBadge>
          <span className="truncate text-xs font-medium">{finding.customDetectorName ?? finding.findingType}</span>
        </div>
        {finding.matchedContent && (
          <p className="line-clamp-2 break-all font-mono text-[11px] leading-snug">{finding.matchedContent}</p>
        )}
        <p className="truncate text-[10px] text-muted-foreground">
          {t("caseBoard.addEvidence.inAsset", { name: finding.assetName ?? "—" })}
        </p>
      </div>
      <PlaceButton status={status} readOnly={readOnly} onPlace={onPlace} testId="add-evidence-place-finding" />
    </li>
  );
}
