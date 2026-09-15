"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  BulkUpdateFindingsDtoSeverityEnum,
  BulkUpdateFindingsDtoStatusEnum,
  ResponseError,
  type FindingResponseDto,
} from "@workspace/api-client";
import { FINDING_SEVERITY_COLOR_BY_ENUM } from "@workspace/ui/lib/finding-severity";
import {
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SeverityBadge,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from "@workspace/ui/components";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@workspace/ui/components/drawer";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { toFindingStatusBadgeValue } from "../lib/finding-status-badge";
import { getSourceIcon } from "../lib/source-type-icon";
import type { FindingSelection } from "./findings-table";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";

// ─── Types ────────────────────────────────────────────────────────────────────

type StatusValue =
  (typeof BulkUpdateFindingsDtoStatusEnum)[keyof typeof BulkUpdateFindingsDtoStatusEnum];

type SeverityValue =
  (typeof BulkUpdateFindingsDtoSeverityEnum)[keyof typeof BulkUpdateFindingsDtoSeverityEnum];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatEnumLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function severityColor(severity: string) {
  const key =
    severity.toUpperCase() as keyof typeof FINDING_SEVERITY_COLOR_BY_ENUM;
  return (
    FINDING_SEVERITY_COLOR_BY_ENUM[key] ?? FINDING_SEVERITY_COLOR_BY_ENUM.INFO
  );
}

// ─── Paginated table ──────────────────────────────────────────────────────────

const DIALOG_PAGE_SIZE = 15;
const NONE = "__none__" as const;
const STATUS_OPTIONS = Object.values(
  BulkUpdateFindingsDtoStatusEnum,
) as StatusValue[];

function FindingsPreviewTable({ selection }: { selection: FindingSelection }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [findings, setFindings] = useState<FindingResponseDto[]>([]);
  const [total, setTotal] = useState(selection.total);
  const [loading, setLoading] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / DIALOG_PAGE_SIZE));

  const loadPage = useCallback(
    async (p: number) => {
      setLoading(true);
      try {
        if (selection.type === "ids") {
          // Paginate client-side — data already available
          const start = (p - 1) * DIALOG_PAGE_SIZE;
          setFindings(
            selection.findings.slice(start, start + DIALOG_PAGE_SIZE),
          );
          setTotal(selection.findings.length);
        } else {
          // Paginate server-side using the saved filter snapshot
          const response =
            await api.assets.searchAssetsControllerSearchFindings({
              searchFindingsRequestDto: {
                filters: selection.filters,
                page: {
                  skip: (p - 1) * DIALOG_PAGE_SIZE,
                  limit: DIALOG_PAGE_SIZE,
                },
              },
            });
          setFindings(response.findings);
          setTotal(response.total);
        }
      } finally {
        setLoading(false);
      }
    },
    [selection],
  );

  useEffect(() => {
    setPage(1);
    void loadPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  useEffect(() => {
    void loadPage(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="relative min-h-0 flex-1 overflow-auto">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background">
            <TableRow>
              {(
                [
                  "findings.columns.category",
                  "findings.columns.finding",
                  "findings.columns.asset",
                  "findings.columns.source",
                  "findings.columns.severity",
                  "findings.columns.status",
                ] as const
              ).map((key) => (
                <TableHead key={key}>
                  <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {t(key)}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {findings.map((finding) => {
              const SourceTypeIcon = getSourceIcon(finding.source?.type);
              const assetLabel =
                finding.asset?.name ||
                finding.asset?.externalUrl ||
                finding.assetId;
              return (
                <TableRow key={finding.id}>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className="gap-1.5 border px-2 py-0.5 text-[11px] uppercase tracking-[0.04em]"
                      style={{
                        color: severityColor(finding.severity),
                        borderColor: `${severityColor(finding.severity)}55`,
                        backgroundColor: `${severityColor(finding.severity)}14`,
                      }}
                    >
                      <span
                        className="h-2 w-2 rounded-[2px]"
                        style={{
                          backgroundColor: severityColor(finding.severity),
                        }}
                      />
                      {formatEnumLabel(finding.detectorType)}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[200px]">
                    <span className="truncate block text-sm font-medium">
                      {finding.findingType}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[180px]">
                    <span className="truncate block text-sm text-muted-foreground">
                      {assetLabel}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <SourceTypeIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate text-sm">
                        {finding.source?.name || finding.sourceId}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <SeverityBadge
                      severity={
                        finding.severity.toLowerCase() as
                          | "critical"
                          | "high"
                          | "medium"
                          | "low"
                          | "info"
                      }
                    >
                      {t(`findings.severityLabels.${finding.severity.toUpperCase()}` as TranslationKey)}
                    </SeverityBadge>
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      status={toFindingStatusBadgeValue(finding.status)}
                    >
                      {t(`findings.statusLabels.${finding.status}` as TranslationKey)}
                    </StatusBadge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t px-4 py-2.5 text-xs text-muted-foreground shrink-0">
          <span>
            {((page - 1) * DIALOG_PAGE_SIZE + 1).toLocaleString()}–
            {Math.min(page * DIALOG_PAGE_SIZE, total).toLocaleString()} of{" "}
            {total.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="px-2 font-mono">
              {page} / {totalPages}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main dialog ──────────────────────────────────────────────────────────────

type BulkUpdateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selection: FindingSelection | null;
  onSuccess?: () => void;
  /** The selection was too large to change in one request and was queued. */
  onQueued?: (operationId: string) => void;
};

export function BulkUpdateDialog({
  open,
  onOpenChange,
  selection,
  onSuccess,
  onQueued,
}: BulkUpdateDialogProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<StatusValue | typeof NONE>(NONE);
  const [severity, setSeverity] = useState<SeverityValue | typeof NONE>(NONE);
  const [comment, setComment] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Select-all only. The table's total stops counting at 10,000, so it cannot
  // be the number a destructive update is checked against: a dry run returns
  // the exact count, and whether the filters narrow anything at all.
  const [exactCount, setExactCount] = useState<number | null>(null);
  const [narrowed, setNarrowed] = useState<boolean | null>(null);
  const [counting, setCounting] = useState(false);
  // The sync save result, kept when it changed fewer findings than the dry
  // run counted — rows already at the target values are not rewrites, so the
  // dialog stays open showing actual vs reviewed instead of closing silently.
  const [savedSummary, setSavedSummary] = useState<{
    updated: number;
    expected: number;
  } | null>(null);

  const selectAllFilters =
    selection?.type === "all" ? selection.filters : undefined;
  // The page can hand over a new selection object carrying the same filters;
  // keying on the serialised value keeps that from re-counting on each render.
  const filtersKey = selectAllFilters ? JSON.stringify(selectAllFilters) : null;
  const filtersRef = useRef(selectAllFilters);
  filtersRef.current = selectAllFilters;

  const refreshExactCount = useCallback(async () => {
    const filters = filtersRef.current;
    if (!filters) return;
    setCounting(true);
    try {
      const preview = await api.findings.findingsControllerBulkUpdate({
        bulkUpdateFindingsDto: { filters, dryRun: true },
      });
      setExactCount(preview.wouldUpdate ?? null);
      setNarrowed(preview.narrowed ?? null);
    } catch (err) {
      setError(
        await extractApiErrorMessage(err, t("findings.bulkUpdate.updateFailed")),
      );
    } finally {
      setCounting(false);
    }
  }, [t]);

  useEffect(() => {
    setExactCount(null);
    setNarrowed(null);
    setSavedSummary(null);
    if (open && filtersKey !== null) void refreshExactCount();
  }, [open, filtersKey, refreshExactCount]);

  const total =
    selection?.type === "all"
      ? (exactCount ?? selection.total)
      : (selection?.total ?? 0);
  const hasChanges =
    status !== NONE || severity !== NONE || comment.trim().length > 0;
  const awaitingCount = selection?.type === "all" && exactCount === null;

  async function handleSave() {
    if (!hasChanges || !selection || awaitingCount) return;
    setIsSaving(true);
    setError(null);
    try {
      const result = await api.findings.findingsControllerBulkUpdate({
        bulkUpdateFindingsDto: {
          ...(selection.type === "ids"
            ? { ids: selection.findings.map((f) => f.id) }
            : {
                filters: selection.filters,
                // If more findings match by the time this lands, the API
                // refuses (409) instead of widening what was reviewed here.
                expectedCount: exactCount ?? undefined,
                // Filters that narrow nothing apply to the whole workspace;
                // the warning above says so, and saving is the confirmation.
                confirm: narrowed === false ? true : undefined,
              }),
          status: status !== NONE ? status : undefined,
          severity: severity !== NONE ? severity : undefined,
          comment: comment.trim() || undefined,
        },
      });
      if (result.async && result.operationId) {
        onQueued?.(result.operationId);
        handleClose();
      } else {
        onSuccess?.();
        // Select-all only: the dialog reviewed `exactCount`, so say what the
        // save actually changed. A short count stays open with a notice
        // rather than closing as if everything matched.
        const updated = result.updatedCount ?? 0;
        if (
          selection.type === "all" &&
          exactCount !== null &&
          updated < exactCount
        ) {
          setSavedSummary({ updated, expected: exactCount });
        } else {
          handleClose();
        }
      }
    } catch (err) {
      if (err instanceof ResponseError && err.response.status === 409) {
        setError(t("findings.bulkUpdate.countChanged"));
        await refreshExactCount();
      } else {
        setError(
          await extractApiErrorMessage(
            err,
            t("findings.bulkUpdate.updateFailed"),
          ),
        );
      }
    } finally {
      setIsSaving(false);
    }
  }

  function handleClose() {
    if (isSaving) return;
    setStatus(NONE);
    setSeverity(NONE);
    setComment("");
    setError(null);
    setSavedSummary(null);
    onOpenChange(false);
  }

  return (
    <Drawer
      open={open}
      direction="right"
      onOpenChange={(nextOpen) => {
        if (!nextOpen) handleClose();
      }}
    >
      <DrawerContent className="flex h-full w-full max-w-none flex-col gap-0 overflow-hidden bg-background p-0 sm:max-w-6xl">
        <DrawerHeader className="border-b px-6 py-5 shrink-0">
          <DrawerTitle className="font-serif text-xl font-black uppercase tracking-[0.06em]">
            {t("findings.bulkUpdate.title")}
          </DrawerTitle>
          <DrawerDescription className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">
              {total !== 1
                ? t("findings.bulkUpdate.applyChangesPlural", { count: total.toLocaleString() })
                : t("findings.bulkUpdate.applyChanges", { count: total.toLocaleString() })}
            </span>
            {selection?.type === "all" && ` ${t("findings.bulkUpdate.matchingFilters")}`}
            {t("findings.bulkUpdate.onlyFilledFields")}
            {counting && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t("findings.bulkUpdate.countingExact")}
              </span>
            )}
          </DrawerDescription>
          {narrowed === false && exactCount !== null && (
            <p
              role="alert"
              className="mt-2 border-l-2 border-destructive pl-3 text-sm text-destructive"
            >
              {t("findings.bulkUpdate.unnarrowedWarning", {
                count: exactCount.toLocaleString(),
              })}
            </p>
          )}
        </DrawerHeader>

        {/* ── Controls ── */}
        <div className="border-b px-6 py-5 space-y-4 shrink-0">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5 min-w-0">
              <label className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
                {t("findings.bulkUpdate.status")}
              </label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as StatusValue | typeof NONE)}
              >
                <SelectTrigger className="h-9 w-full border-2 border-border rounded-[4px]">
                  <SelectValue
                    placeholder={t("findings.bulkUpdate.noChange")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>
                    {t("findings.bulkUpdate.noChange")}
                  </SelectItem>
                  {STATUS_OPTIONS.map((value) => (
                    <SelectItem key={value} value={value}>
                      <StatusBadge status={toFindingStatusBadgeValue(value)}>
                        {t(`findings.statusLabels.${value}` as TranslationKey)}
                      </StatusBadge>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 min-w-0">
              <label className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
                {t("findings.bulkUpdate.severity")}
              </label>
              <Select
                value={severity}
                onValueChange={(v) =>
                  setSeverity(v as SeverityValue | typeof NONE)
                }
              >
                <SelectTrigger className="h-9 w-full border-2 border-border rounded-[4px]">
                  <SelectValue
                    placeholder={t("findings.bulkUpdate.noChange")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>
                    {t("findings.bulkUpdate.noChange")}
                  </SelectItem>
                  {Object.values(BulkUpdateFindingsDtoSeverityEnum).map((value) => (
                    <SelectItem key={value} value={value}>
                      <SeverityBadge
                        severity={value.toLowerCase() as "critical" | "high" | "medium" | "low" | "info"}
                      >
                        {t(`findings.severityLabels.${value}` as TranslationKey)}
                      </SeverityBadge>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
              {t("findings.bulkUpdate.comment")}
            </label>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t("findings.bulkUpdate.commentPlaceholder")}
              className="min-h-[80px] resize-y border-2 border-border rounded-[4px] text-sm"
              rows={3}
            />
          </div>
        </div>

        {/* ── Findings preview ── */}
        <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
          {selection && <FindingsPreviewTable selection={selection} />}
        </div>

        {/* ── Footer ── */}
        <div className="border-t px-6 py-4 flex items-center justify-between gap-4 shrink-0 flex-col">
          {savedSummary ? (
            <p role="status" className="text-xs text-muted-foreground">
              {t("findings.bulkUpdate.updatedVsMatched", {
                updated: savedSummary.updated.toLocaleString(),
                expected: savedSummary.expected.toLocaleString(),
              })}{" "}
              {t("findings.bulkUpdate.shortCountNotice")}
            </p>
          ) : error ? (
            <p className="text-xs text-destructive">{error}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {hasChanges
                ? t("findings.bulkUpdate.willApply", { count: total.toLocaleString() })
                : t("findings.bulkUpdate.selectAtLeastOne")}
            </p>
          )}
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={isSaving}
              className="border-2 border-border rounded-[4px]"
            >
              {t("findings.bulkUpdate.cancel")}
            </Button>
            <Button
              onClick={savedSummary ? handleClose : handleSave}
              disabled={
                !savedSummary && (!hasChanges || isSaving || awaitingCount)
              }
              className="border-2 border-border rounded-[4px] bg-foreground text-background hover:bg-foreground/90"
            >
              {savedSummary ? (
                t("findings.bulkUpdate.close")
              ) : isSaving ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  {t("findings.bulkUpdate.saving")}
                </>
              ) : total !== 1
                ? t("findings.bulkUpdate.updateFindings", { count: total.toLocaleString() })
                : t("findings.bulkUpdate.updateFinding", { count: total.toLocaleString() })}
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
