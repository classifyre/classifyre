"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate, formatRelative, formatShortUTC } from "@/lib/date";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Fingerprint,
  Filter,
  Pencil,
  Plus,
  Search,
  X,
} from "lucide-react";
import {
  api,
  type CaseEvidenceDto,
  type CaseFindingDto,
} from "@workspace/api-client";
import { FINDING_SEVERITY_COLOR_BY_ENUM } from "@workspace/ui/lib/finding-severity";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SeverityBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
const DEFAULT_PAGE_SIZE = 10;

// ─── Severity ordering (for sort) ─────────────────────────────────────────────

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
};
function severityRank(s: string | undefined | null) {
  return SEVERITY_ORDER[(s ?? "").toUpperCase()] ?? 99;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPageItems(current: number, total: number) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, current, total]);
  if (current > 2) pages.add(current - 1);
  if (current < total - 1) pages.add(current + 1);
  return Array.from(pages).sort((a, b) => a - b);
}

function severityColor(severity: string) {
  const key = severity.toUpperCase() as keyof typeof FINDING_SEVERITY_COLOR_BY_ENUM;
  return FINDING_SEVERITY_COLOR_BY_ENUM[key] ?? FINDING_SEVERITY_COLOR_BY_ENUM.INFO;
}

function formatEnumLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

// ─── SortableHead ─────────────────────────────────────────────────────────────

type SortDir = "asc" | "desc";

function SortableHead({
  label,
  tooltip,
  column,
  sortCol,
  sortDir,
  onSort,
  className,
}: {
  label: string;
  tooltip: string;
  column: string;
  sortCol: string;
  sortDir: SortDir;
  onSort: (col: string) => void;
  className?: string;
}) {
  const active = sortCol === column;
  return (
    <TableHead className={className}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => onSort(column)}
            className="flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground transition-colors"
          >
            {label}
            <span className={`opacity-${active ? "100" : "30"}`}>
              {active ? (sortDir === "asc" ? "↑" : "↓") : <ArrowUpDown className="h-2.5 w-2.5" />}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TableHead>
  );
}

// ─── NoteCell ─────────────────────────────────────────────────────────────────

function NoteCell({
  id,
  note,
  onSave,
}: {
  id: string;
  note: string;
  onSave: (id: string, value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setDraft(note);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const commit = useCallback(() => {
    if (!editing) return;
    setEditing(false);
    onSave(id, draft);
  }, [editing, id, draft, onSave]);

  const cancel = useCallback(() => {
    setEditing(false);
    setDraft(note);
  }, [note]);

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") cancel();
        }}
        className="h-7 min-w-[140px] rounded-[4px] border-accent text-xs"
      />
    );
  }

  return (
    <div className="flex min-w-[120px] items-center gap-1.5">
      <span className={`text-xs ${note ? "" : "italic text-muted-foreground"}`}>
        {note || "Add note…"}
      </span>
      <button
        onClick={startEdit}
        className="flex-shrink-0 opacity-40 transition-opacity hover:opacity-100"
        aria-label="Edit note"
      >
        <Pencil className="h-3 w-3 text-muted-foreground" />
      </button>
    </div>
  );
}

// ─── FindingsSubTable ─────────────────────────────────────────────────────────

type SubSortCol = "label" | "detector" | "severity" | "added";

function FindingsSubTable({
  findings,
  noteOverrides,
  onRemoveFinding,
  onNoteSave,
  t,
}: {
  findings: CaseFindingDto[];
  noteOverrides: Map<string, string>;
  onRemoveFinding: (caseFindingId: string) => Promise<void>;
  onNoteSave: (caseFindingId: string, note: string) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  const router = useRouter();
  const [sortCol, setSortCol] = useState<SubSortCol>("added");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const handleSort = (col: SubSortCol) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  const sorted = useMemo(() => {
    return [...findings].sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "label":
          cmp = a.findingLabel.localeCompare(b.findingLabel);
          break;
        case "detector": {
          const da = (a.customDetectorName ?? a.detectorType ?? "").toLowerCase();
          const db = (b.customDetectorName ?? b.detectorType ?? "").toLowerCase();
          cmp = da.localeCompare(db);
          break;
        }
        case "severity":
          cmp = severityRank(a.severity) - severityRank(b.severity);
          break;
        case "added":
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [findings, sortCol, sortDir]);

  if (findings.length === 0) {
    return (
      <div className="py-4 text-center text-xs uppercase tracking-[0.14em] text-muted-foreground">
        {t("cases.evidence.subTable.noFindings")}
      </div>
    );
  }

  const subSortableHead = (col: SubSortCol, labelKey: TranslationKey, tooltipKey: TranslationKey) => (
    <TableHead className="text-[10px] uppercase tracking-[0.14em]">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => handleSort(col)}
            className="flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground transition-colors"
          >
            {t(labelKey)}
            <span className={`opacity-${sortCol === col ? "100" : "30"}`}>
              {sortCol === col
                ? sortDir === "asc"
                  ? "↑"
                  : "↓"
                : <ArrowUpDown className="h-2.5 w-2.5" />}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent>{t(tooltipKey)}</TooltipContent>
      </Tooltip>
    </TableHead>
  );

  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/30">
          {subSortableHead("detector", "cases.evidence.subTable.detectorType", "cases.evidence.subTable.tooltips.detectorType")}
          {subSortableHead("label", "cases.evidence.subTable.findingLabel", "cases.evidence.subTable.tooltips.findingLabel")}
          <TableHead className="text-[10px] uppercase tracking-[0.14em]">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default">{t("cases.evidence.subTable.matchedContent")}</span>
              </TooltipTrigger>
              <TooltipContent>{t("cases.evidence.subTable.tooltips.matchedContent")}</TooltipContent>
            </Tooltip>
          </TableHead>
          {subSortableHead("severity", "cases.evidence.subTable.severity", "cases.evidence.subTable.tooltips.severity")}
          <TableHead className="text-[10px] uppercase tracking-[0.14em]">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default">{t("cases.evidence.subTable.note")}</span>
              </TooltipTrigger>
              <TooltipContent>{t("cases.evidence.subTable.tooltips.note")}</TooltipContent>
            </Tooltip>
          </TableHead>
          {subSortableHead("added", "cases.evidence.subTable.added", "cases.evidence.subTable.tooltips.added")}
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((f) => {
          const note = noteOverrides.has(f.id)
            ? (noteOverrides.get(f.id) ?? "")
            : (f.note ?? "");
          const detectorLabel = f.customDetectorName
            ? f.customDetectorName
            : f.detectorType
              ? formatEnumLabel(f.detectorType)
              : null;
          const detectorColor = f.severity ? severityColor(f.severity) : "var(--muted-foreground)";

          return (
            <TableRow key={f.id} className="group">
              {/* ── Detector type badge ── */}
              <TableCell className="py-2">
                {detectorLabel ? (
                  <Badge
                    variant="outline"
                    className="gap-1 border px-2 py-0.5 text-[11px] uppercase tracking-[0.04em]"
                    style={{
                      color: detectorColor,
                      borderColor: `${detectorColor}55`,
                      backgroundColor: `${detectorColor}14`,
                    }}
                  >
                    {detectorLabel}
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>

              {/* ── Finding label ── */}
              <TableCell className="font-mono text-[11px]">
                <span className="flex items-center gap-1.5">
                  <Fingerprint className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <button
                    className="text-left hover:underline"
                    onClick={() => router.push(`/findings/${f.findingId}`)}
                  >
                    {f.findingLabel}
                  </button>
                </span>
              </TableCell>

              {/* ── Matched content ── */}
              <TableCell className="max-w-[200px] py-2">
                {f.matchedContent ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="block truncate max-w-[180px] font-mono text-[11px] text-muted-foreground cursor-default">
                        {f.matchedContent}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={6} className="max-w-[360px] break-all font-mono">
                      {f.matchedContent}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>

              {/* ── Severity ── */}
              <TableCell>
                {f.severity ? (
                  <SeverityBadge
                    severity={f.severity.toLowerCase() as "critical" | "high" | "medium" | "low" | "info"}
                  >
                    {f.severity}
                  </SeverityBadge>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>

              {/* ── Note ── */}
              <TableCell className="max-w-[220px] py-1.5">
                <NoteCell id={f.id} note={note} onSave={onNoteSave} />
              </TableCell>

              {/* ── Added date ── */}
              <TableCell className="py-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-default text-xs text-muted-foreground">
                      {formatRelative(f.createdAt)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <div>{formatDate(f.createdAt)}</div>
                    {formatShortUTC(f.createdAt) && (
                      <div className="text-muted-foreground/70">
                        {formatShortUTC(f.createdAt)}
                      </div>
                    )}
                  </TooltipContent>
                </Tooltip>
              </TableCell>

              {/* ── Remove ── */}
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => void onRemoveFinding(f.id)}
                  aria-label="Remove finding"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type EvidenceSortCol = "label" | "findings" | "added";

type EvidenceTableProps = {
  evidence: CaseEvidenceDto[];
  onRemoveEvidence: (evidenceId: string) => Promise<void>;
  onRemoveFinding: (caseFindingId: string) => Promise<void>;
  onAddEvidence: () => void;
  onNoteChange?: (evidenceId: string, note: string) => Promise<void>;
  onFindingNoteChange?: (caseFindingId: string, note: string) => Promise<void>;
  /**
   * Invoked when the analyst wants to attach more findings to an asset's
   * evidence row — the case page navigates to the dedicated add-evidence page.
   */
  onAddFindings?: (assetId: string) => void;
};

export function EvidenceTable({
  evidence,
  onRemoveEvidence,
  onRemoveFinding,
  onAddEvidence,
  onNoteChange,
  onFindingNoteChange,
  onAddFindings,
}: EvidenceTableProps) {
  const { t } = useTranslation();
  const router = useRouter();

  // ── Filter / pagination ──────────────────────────────────────────────────

  const [searchInput, setSearchInput] = useState("");
  const [pageSize, setPageSize] = useState(String(DEFAULT_PAGE_SIZE));
  const [page, setPage] = useState(1);

  // ── Evidence-table sort ──────────────────────────────────────────────────

  const [sortCol, setSortCol] = useState<EvidenceSortCol>("added");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const handleSort = (col: EvidenceSortCol) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  // ── Row state ────────────────────────────────────────────────────────────

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // ── Available-count fetch ────────────────────────────────────────────────

  const [availableCounts, setAvailableCounts] = useState<Map<string, number | null>>(new Map());

  useEffect(() => {
    if (!onAddFindings) return;
    const assetRows = evidence.filter((e) => e.entityType.toLowerCase() === "asset");
    if (assetRows.length === 0) return;

    let active = true;
    const run = async () => {
      await Promise.all(
        assetRows.map(async (e) => {
          try {
            const result = await api.assets.searchAssetsControllerSearchFindings({
              searchFindingsRequestDto: {
                filters: { assetId: [e.entityId] },
                page: { skip: 0, limit: 1 },
              },
            });
            if (!active) return;
            const attached = (e.findings ?? []).length;
            const available = Math.max(0, (result.total ?? 0) - attached);
            setAvailableCounts((prev) => new Map(prev).set(e.id, available));
          } catch {
            if (!active) return;
            setAvailableCounts((prev) => new Map(prev).set(e.id, null));
          }
        }),
      );
    };
    void run();
    return () => {
      active = false;
    };
  }, [evidence, onAddFindings]);

  // ── Note overrides ───────────────────────────────────────────────────────

  const [noteOverrides, setNoteOverrides] = useState<Map<string, string>>(new Map());
  const [findingNoteOverrides, setFindingNoteOverrides] = useState<Map<string, string>>(new Map());

  const getNote = (e: CaseEvidenceDto) =>
    noteOverrides.has(e.id) ? (noteOverrides.get(e.id) ?? "") : (e.note ?? "");

  const handleNoteSave = useCallback(
    (evidenceId: string, value: string) => {
      setNoteOverrides((prev) => new Map(prev).set(evidenceId, value));
      void onNoteChange?.(evidenceId, value);
    },
    [onNoteChange],
  );

  const handleFindingNoteSave = useCallback(
    (caseFindingId: string, value: string) => {
      setFindingNoteOverrides((prev) => new Map(prev).set(caseFindingId, value));
      void onFindingNoteChange?.(caseFindingId, value);
    },
    [onFindingNoteChange],
  );

  // ── Filtered / sorted / paged data ──────────────────────────────────────

  const filtered = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    const base = q
      ? evidence.filter((e) => {
          const label = (e.entity?.label ?? e.entityId).toLowerCase();
          const type = e.entityType.toLowerCase();
          const sourceType = (e.entity?.sourceType ?? "").toLowerCase();
          const note = getNote(e).toLowerCase();
          return (
            label.includes(q) ||
            type.includes(q) ||
            sourceType.includes(q) ||
            note.includes(q)
          );
        })
      : evidence;

    return [...base].sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "label":
          cmp = (a.entity?.label ?? a.entityId).localeCompare(b.entity?.label ?? b.entityId);
          break;
        case "findings":
          cmp = (a.findings?.length ?? 0) - (b.findings?.length ?? 0);
          break;
        case "added":
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evidence, searchInput, noteOverrides, sortCol, sortDir]);

  const resolvedPageSize = Number(pageSize);
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, resolvedPageSize)));
  const clampedPage = Math.min(page, totalPages);
  const canPrev = clampedPage > 1;
  const canNext = clampedPage < totalPages;
  const pageItems = useMemo(() => getPageItems(clampedPage, totalPages), [clampedPage, totalPages]);
  const pageSlice = useMemo(
    () => filtered.slice((clampedPage - 1) * resolvedPageSize, clampedPage * resolvedPageSize),
    [filtered, clampedPage, resolvedPageSize],
  );
  const hasRows = pageSlice.length > 0;

  const toggleExpanded = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // ── Shared sort header builder ───────────────────────────────────────────

  const evidenceSortHead = (
    col: EvidenceSortCol,
    labelKey: TranslationKey,
    tooltipKey: TranslationKey,
    extraClass?: string,
  ) => (
    <SortableHead
      label={t(labelKey)}
      tooltip={t(tooltipKey)}
      column={col}
      sortCol={sortCol}
      sortDir={sortDir}
      onSort={(c) => handleSort(c as EvidenceSortCol)}
      className={`bg-white/95 dark:bg-card/95 ${extraClass ?? ""}`}
    />
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-[1.6]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setPage(1);
            }}
            placeholder={t("cases.evidence.search")}
            className="h-9 rounded-[4px] border-2 border-border pl-9"
          />
        </div>
        <div className="ml-auto">
          <Button onClick={onAddEvidence} size="sm">
            <Plus className="h-4 w-4" />
            {t("cases.evidence.addEvidence")}
          </Button>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="relative min-h-[200px]">
        {!hasRows ? (
          <EmptyState
            icon={Filter}
            title={t("cases.evidence.noEvidence")}
            description={t("cases.evidence.noEvidenceHint")}
          />
        ) : (
          <div className="max-h-[70vh] overflow-auto rounded-[4px] bg-white dark:bg-card">
            <Table>
              <TableHeader className="sticky top-0 z-20 bg-white/95 backdrop-blur dark:bg-card/95 supports-[backdrop-filter]:bg-white/80 dark:supports-[backdrop-filter]:bg-card/80">
                <TableRow>
                  <TableHead className="w-8 bg-white/95 dark:bg-card/95" />
                  {evidenceSortHead("label", "cases.evidence.columns.entity", "cases.evidence.tooltips.entity")}
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          {t("cases.evidence.columns.type")}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{t("cases.evidence.tooltips.type")}</TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          {t("cases.evidence.columns.sourceType")}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{t("cases.evidence.tooltips.sourceType")}</TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          {t("cases.evidence.columns.assetType")}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{t("cases.evidence.tooltips.assetType")}</TooltipContent>
                    </Tooltip>
                  </TableHead>
                  {evidenceSortHead("findings", "cases.evidence.columns.findings", "cases.evidence.tooltips.findings")}
                  <TableHead className="bg-white/95 dark:bg-card/95">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          {t("cases.evidence.columns.note")}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{t("cases.evidence.tooltips.note")}</TooltipContent>
                    </Tooltip>
                  </TableHead>
                  {evidenceSortHead("added", "cases.evidence.columns.added", "cases.evidence.tooltips.added")}
                  <TableHead className="w-10 bg-white/95 dark:bg-card/95" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageSlice.map((e) => {
                  const isExpanded = expandedIds.has(e.id);
                  const findings = e.findings ?? [];
                  const label = e.entity?.label ?? e.entityId;
                  const isAsset = e.entityType.toLowerCase() === "asset";
                  const availableCount = availableCounts.get(e.id) ?? null;
                  const showAddBtn =
                    isAsset &&
                    onAddFindings !== undefined &&
                    availableCount !== null &&
                    availableCount > 0;

                  return (
                    <Fragment key={e.id}>
                      <TableRow className="group align-top" data-testid="evidence-row">
                        {/* ── Expand chevron ── */}
                        <TableCell className="py-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            disabled={findings.length === 0}
                            onClick={() => toggleExpanded(e.id)}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                          </Button>
                        </TableCell>

                        {/* ── Entity label ── */}
                        <TableCell className="max-w-[280px] py-2">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              {isAsset ? (
                                <button
                                  className="block max-w-[260px] truncate text-left text-sm font-medium hover:underline"
                                  onClick={() => router.push(`/assets/${e.entityId}`)}
                                >
                                  {label}
                                </button>
                              ) : (
                                <span className="block max-w-[260px] cursor-default truncate text-sm font-medium">
                                  {label}
                                </span>
                              )}
                            </TooltipTrigger>
                            <TooltipContent side="top" sideOffset={6}>{label}</TooltipContent>
                          </Tooltip>
                          {e.addedBy && (
                            <span className="block text-[11px] text-muted-foreground">
                              by {e.addedBy}
                            </span>
                          )}
                        </TableCell>

                        {/* ── Entity type ── */}
                        <TableCell className="py-2">
                          <Badge
                            variant="outline"
                            className="rounded-[4px] text-[11px] uppercase tracking-[0.04em]"
                          >
                            {e.entityType}
                          </Badge>
                        </TableCell>

                        {/* ── Source type ── */}
                        <TableCell className="py-2">
                          {e.entity?.sourceType ? (
                            <span className="font-mono text-xs text-muted-foreground">
                              {e.entity.sourceType}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>

                        {/* ── Asset type ── */}
                        <TableCell className="py-2">
                          {e.entity?.assetType ? (
                            <span className="font-mono text-xs text-muted-foreground">
                              {e.entity.assetType}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>

                        {/* ── Findings count + "add more" chip ── */}
                        <TableCell className="py-2">
                          <div className="flex items-center gap-2">
                            {findings.length > 0 ? (
                              <button
                                className="tabular-nums text-sm font-medium hover:underline"
                                onClick={() => toggleExpanded(e.id)}
                              >
                                {findings.length}
                              </button>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                            {showAddBtn && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={() => onAddFindings?.(e.entityId)}
                                    className="inline-flex items-center gap-0.5 rounded-[3px] border border-dashed border-accent/40 px-1.5 py-0.5 font-mono text-[10px] text-accent transition-colors hover:border-accent hover:bg-accent/5"
                                  >
                                    <Plus className="h-2.5 w-2.5" />
                                    {availableCount}
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {availableCount} more finding
                                  {availableCount === 1 ? "" : "s"} available — click to add
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </TableCell>

                        {/* ── Note — inline edit ── */}
                        <TableCell className="max-w-[200px] py-2">
                          <NoteCell id={e.id} note={getNote(e)} onSave={handleNoteSave} />
                        </TableCell>

                        {/* ── Added date ── */}
                        <TableCell className="py-2">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-default text-xs text-muted-foreground">
                                {formatRelative(e.createdAt)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="left">
                              <div>{formatDate(e.createdAt)}</div>
                              {formatShortUTC(e.createdAt) && (
                                <div className="text-muted-foreground/70">
                                  {formatShortUTC(e.createdAt)}
                                </div>
                              )}
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>

                        {/* ── Remove ── */}
                        <TableCell className="py-2 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100"
                            onClick={() => void onRemoveEvidence(e.id)}
                            aria-label="Remove evidence"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>

                      {/* ── Expanded row ── */}
                      {isExpanded && (
                        <TableRow>
                          <TableCell colSpan={9} className="bg-muted/15 p-0">
                            <div className="px-4 py-3">
                              <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                {t("cases.evidence.subTable.attachedFindings")} ({findings.length})
                              </p>
                              <FindingsSubTable
                                findings={findings}
                                noteOverrides={findingNoteOverrides}
                                onRemoveFinding={onRemoveFinding}
                                onNoteSave={handleFindingNoteSave}
                                t={t}
                              />

                              {showAddBtn && (
                                <div className="mt-3">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 gap-1.5 rounded-[4px] border-dashed border-accent/40 font-mono text-[11px] text-accent hover:border-accent hover:bg-accent/5"
                                    onClick={() => onAddFindings?.(e.entityId)}
                                  >
                                    <Plus className="h-3 w-3" />
                                    {t("cases.evidence.subTable.availableFindings")} ({availableCount})
                                  </Button>
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t("common.rowsPerPage")}</span>
          <Select
            value={pageSize}
            onValueChange={(v) => {
              setPageSize(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-8 w-[130px] rounded-[4px] border-2 border-border">
              <SelectValue placeholder={t("common.rowsPerPage")} />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {t("common.rows", { size })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {total > 0
              ? `${((clampedPage - 1) * resolvedPageSize + 1).toLocaleString()}–${Math.min(clampedPage * resolvedPageSize, total).toLocaleString()} of ${total.toLocaleString()}`
              : "0 evidence items"}
          </span>
        </div>

        {totalPages > 1 && (
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  label={t("common.pagination.previous")}
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    if (canPrev) setPage(clampedPage - 1);
                  }}
                  className={!canPrev ? "pointer-events-none opacity-50" : undefined}
                />
              </PaginationItem>
              {pageItems.map((pageNumber, index) => {
                const prev = pageItems[index - 1];
                const showEllipsis = prev && pageNumber - prev > 1;
                return (
                  <Fragment key={`page-group-${pageNumber}`}>
                    {showEllipsis && (
                      <PaginationItem>
                        <PaginationEllipsis label={t("common.pagination.morePages")} />
                      </PaginationItem>
                    )}
                    <PaginationItem>
                      <PaginationLink
                        href="#"
                        isActive={pageNumber === clampedPage}
                        onClick={(e) => {
                          e.preventDefault();
                          setPage(pageNumber);
                        }}
                      >
                        {pageNumber}
                      </PaginationLink>
                    </PaginationItem>
                  </Fragment>
                );
              })}
              <PaginationItem>
                <PaginationNext
                  label={t("common.pagination.next")}
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    if (canNext) setPage(clampedPage + 1);
                  }}
                  className={!canNext ? "pointer-events-none opacity-50" : undefined}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        )}
      </div>

    </div>
  );
}
