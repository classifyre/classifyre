"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type SearchSourceItemDto } from "@workspace/api-client";
import {
  Badge,
  Button,
  Checkbox,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@workspace/ui/components/drawer";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { getSourceLabel } from "@workspace/schemas/source-labels";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { getSourceIcon } from "@/lib/source-type-icon";
import {
  defaultScheduleValue,
  ScheduleCard,
  scheduleFieldsFor,
} from "./schedule-card";
import {
  defaultSamplingValue,
  SamplingCard,
  type SamplingValue,
} from "./sampling-card";
import type { SourceSelection } from "./sources-table";

const DIALOG_PAGE_SIZE = 15;
const CHECKBOX_CLASS =
  "border-2 border-foreground/25 rounded-[2px] data-[state=checked]:bg-accent data-[state=checked]:border-accent data-[state=checked]:text-accent-foreground";

function scheduleSummary(
  source: SearchSourceItemDto,
  t: (key: TranslationKey) => string,
) {
  if (source.scheduleMode === "AUTO") return t("schedule.modeAutomatic");
  if (source.scheduleMode === "CRON" || source.scheduleEnabled) {
    return source.scheduleCron
      ? `${source.scheduleCron} (${source.scheduleTimezone ?? "UTC"})`
      : t("schedule.modeFixed");
  }
  return t("sources.detail.manualOnly");
}

function SourcesPreviewTable({ selection }: { selection: SourceSelection }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [sources, setSources] = useState<SearchSourceItemDto[]>([]);
  const [total, setTotal] = useState(selection.total);
  const [loading, setLoading] = useState(false);
  const totalPages = Math.max(1, Math.ceil(total / DIALOG_PAGE_SIZE));

  const loadPage = useCallback(
    async (nextPage: number) => {
      setLoading(true);
      try {
        if (selection.type === "ids") {
          const start = (nextPage - 1) * DIALOG_PAGE_SIZE;
          setSources(selection.sources.slice(start, start + DIALOG_PAGE_SIZE));
          setTotal(selection.sources.length);
        } else {
          const response = await api.searchSources({
            filters: selection.filters,
            page: {
              skip: (nextPage - 1) * DIALOG_PAGE_SIZE,
              limit: DIALOG_PAGE_SIZE,
            },
          });
          setSources(response.items);
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
  }, [loadPage]);

  useEffect(() => {
    if (page !== 1) void loadPage(page);
  }, [loadPage, page]);

  return (
    <div className="flex flex-col rounded-[6px] border-2 border-border bg-card">
      <div className="relative overflow-x-auto">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("sources.columns.source")}</TableHead>
              <TableHead>{t("sources.columns.type")}</TableHead>
              <TableHead>{t("sources.detail.scheduleSection")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.map((source) => {
              const SourceIcon = getSourceIcon(source.type);
              return (
                <TableRow key={source.id}>
                  <TableCell className="font-medium">{source.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="gap-1.5">
                      <SourceIcon className="h-3.5 w-3.5" />
                      {getSourceLabel(source.type)}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {scheduleSummary(source, t)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex shrink-0 items-center justify-between border-t-2 border-border px-4 py-2.5 text-xs text-muted-foreground">
          <span>
            {((page - 1) * DIALOG_PAGE_SIZE + 1).toLocaleString()}–
            {Math.min(page * DIALOG_PAGE_SIZE, total).toLocaleString()}{" "}
            {t("common.of")} {total.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={page <= 1}
              onClick={() => setPage((current) => current - 1)}
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
              onClick={() => setPage((current) => current + 1)}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

type BulkUpdateSourcesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selection: SourceSelection | null;
  onSuccess?: () => void;
};

export function BulkUpdateSourcesDialog({
  open,
  onOpenChange,
  selection,
  onSuccess,
}: BulkUpdateSourcesDialogProps) {
  const { t } = useTranslation();
  const [applySchedule, setApplySchedule] = useState(false);
  const [applySampling, setApplySampling] = useState(false);
  const [schedule, setSchedule] = useState(defaultScheduleValue());
  const [sampling, setSampling] = useState<SamplingValue>(
    defaultSamplingValue(),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = selection?.total ?? 0;
  const hasChanges = applySchedule || applySampling;

  function reset() {
    setApplySchedule(false);
    setApplySampling(false);
    setSchedule(defaultScheduleValue());
    setSampling(defaultSamplingValue());
    setError(null);
  }

  function handleClose() {
    if (isSaving) return;
    reset();
    onOpenChange(false);
  }

  async function handleSave() {
    if (!selection || !hasChanges) return;
    setIsSaving(true);
    setError(null);
    try {
      const scheduleFields = scheduleFieldsFor(schedule);
      await api.sources.sourcesControllerBulkUpdateSources({
        bulkUpdateSourcesDto: {
          ...(selection.type === "ids"
            ? { ids: selection.sources.map((source) => source.id) }
            : { filters: selection.filters }),
          schedule: applySchedule
            ? {
                mode: scheduleFields.scheduleMode,
                cron: scheduleFields.scheduleCron,
                timezone: scheduleFields.scheduleTimezone,
              }
            : undefined,
          sampling: applySampling
            ? {
                strategy: sampling.strategy,
                orderByColumn: sampling.order_by_column,
                fallbackToRandom: sampling.fallback_to_random,
                rowsPerPage: sampling.rows_per_page,
                includeColumnNames: sampling.include_column_names,
              }
            : undefined,
        },
      });
      onSuccess?.();
      reset();
      onOpenChange(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : t("sources.bulkUpdate.failed"),
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      direction="right"
      onOpenChange={(nextOpen) => {
        if (!nextOpen) handleClose();
      }}
    >
      <DrawerContent className="flex h-full flex-col gap-0 overflow-hidden bg-background p-0 sm:data-[vaul-drawer-direction=right]:w-[92vw] sm:data-[vaul-drawer-direction=right]:max-w-[880px]">
        <DrawerHeader className="shrink-0 border-b px-6 py-5">
          <DrawerTitle className="font-serif text-xl font-black uppercase tracking-[0.06em]">
            {t("sources.bulkUpdate.title")}
          </DrawerTitle>
          <DrawerDescription className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">
              {t("sources.bulkUpdate.applyTo", {
                count: total.toLocaleString(),
              })}
            </span>
            {selection?.type === "all" &&
              ` ${t("sources.bulkUpdate.matchingFilters")}`}
            {` ${t("sources.bulkUpdate.onlySelectedSections")}`}
          </DrawerDescription>
        </DrawerHeader>

        <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-6 py-6">
          <section className="space-y-3">
            <label className="flex w-full cursor-pointer items-center gap-2 font-mono text-xs font-bold uppercase tracking-[0.08em]">
              <Checkbox
                checked={applySchedule}
                onCheckedChange={(checked) => setApplySchedule(checked === true)}
                className={CHECKBOX_CLASS}
              />
              {t("sources.bulkUpdate.applySchedule")}
            </label>
            <ScheduleCard
              value={schedule}
              onChange={setSchedule}
              disabled={!applySchedule || isSaving}
              className="w-full"
            />
          </section>

          <section className="space-y-3">
            <label className="flex w-full cursor-pointer items-center gap-2 font-mono text-xs font-bold uppercase tracking-[0.08em]">
              <Checkbox
                checked={applySampling}
                onCheckedChange={(checked) => setApplySampling(checked === true)}
                className={CHECKBOX_CLASS}
              />
              {t("sources.bulkUpdate.applySampling")}
            </label>
            <SamplingCard
              value={sampling}
              onChange={setSampling}
              disabled={!applySampling || isSaving}
              className="w-full"
            />
          </section>

          <section className="space-y-3">
            <p className="font-mono text-xs font-bold uppercase tracking-[0.08em]">
              {t("sources.bulkUpdate.affectedSources", {
                count: total.toLocaleString(),
              })}
            </p>
            {selection && <SourcesPreviewTable selection={selection} />}
          </section>
        </div>

        <div className="flex shrink-0 flex-col items-center justify-between gap-4 border-t px-6 py-4 sm:flex-row">
          {error ? (
            <p className="text-xs text-destructive">{error}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {hasChanges
                ? t("sources.bulkUpdate.ready", {
                    count: total.toLocaleString(),
                  })
                : t("sources.bulkUpdate.chooseSection")}
            </p>
          )}
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={isSaving}
              className="rounded-[4px] border-2 border-border"
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
              className="rounded-[4px] border-2 border-border bg-foreground text-background hover:bg-foreground/90"
            >
              {isSaving && (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              )}
              {isSaving
                ? t("sources.bulkUpdate.saving")
                : t("sources.bulkUpdate.updateSources", {
                    count: total.toLocaleString(),
                  })}
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
