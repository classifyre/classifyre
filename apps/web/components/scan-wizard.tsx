"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@workspace/ui/components/button";
import { Badge } from "@workspace/ui/components/badge";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Spinner } from "@workspace/ui/components/spinner";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@workspace/ui/components/drawer";
import { Separator } from "@workspace/ui/components/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table";
import { Loader2, Play } from "lucide-react";
import {
  api,
  type SourcesControllerListSources200ResponseInner,
  type StartRunnerDto,
} from "@workspace/api-client";
import {
  getRunnerStatusBadgeLabel,
  getRunnerStatusBadgeTone,
  isRunnerStatusRunning,
} from "../lib/runner-status-badge";
import { useTranslation } from "@/hooks/use-translation";

interface ScanWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Source = SourcesControllerListSources200ResponseInner;
const isSourceRunning = (status?: string | null) =>
  isRunnerStatusRunning(status);

export function ScanWizard({ open, onOpenChange }: ScanWizardProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState("");

  const fetchSources = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.sources.sourcesControllerListSources();
      setSources(
        data as unknown as SourcesControllerListSources200ResponseInner[],
      );
    } catch (err) {
      console.error("Failed to fetch sources:", err);
      setError(err instanceof Error ? err.message : "Failed to load sources");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setSourceId("");
    fetchSources();
  }, [open]);

  const handleSubmit = async () => {
    const selectedSource = sources.find((source) => source.id === sourceId);
    if (
      !sourceId ||
      submitting ||
      isSourceRunning(selectedSource?.runnerStatus)
    ) {
      return;
    }
    try {
      setSubmitting(true);
      setError(null);
      const startRunnerDto: StartRunnerDto = {
        triggerType: "MANUAL",
      };
      const runner = await api.runners.cliRunnerControllerStartRunner({
        sourceId,
        startRunnerDto,
      });
      onOpenChange(false);
      if (runner?.id) {
        router.push(`/scans/${runner.id}`);
      } else {
        router.push(`/scans`);
        router.refresh();
      }
    } catch (err) {
      console.error("Failed to start scan:", err);
      setError(err instanceof Error ? err.message : "Failed to start scan");
    } finally {
      setSubmitting(false);
    }
  };

  const selectedSource = sources.find((source) => source.id === sourceId);
  const canRun =
    Boolean(sourceId) &&
    !loading &&
    !submitting &&
    !isSourceRunning(selectedSource?.runnerStatus);

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent className="h-full w-full sm:max-w-[760px]">
        <DrawerHeader className="border-b">
          <DrawerTitle>{t("sources.scanWizard.title")}</DrawerTitle>
          <DrawerDescription>
            {t("sources.scanWizard.description")}
          </DrawerDescription>
        </DrawerHeader>

        {/* Step Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("sources.scanWizard.instruction")}
            </p>
            {loading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("sources.scanWizard.loading")}
              </div>
            ) : (
              <div className="overflow-hidden rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        {t("common.selectOption")}
                      </TableHead>
                      <TableHead>{t("common.name")}</TableHead>
                      <TableHead>{t("common.type")}</TableHead>
                      <TableHead>{t("common.status")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sources.map((source) => {
                      const id = source.id ?? "";
                      if (!id) return null;

                      const normalizedRunnerStatus =
                        source.runnerStatus?.toUpperCase();
                      const isRunning = isSourceRunning(normalizedRunnerStatus);
                      const isSelected = sourceId === id;
                      const isDisabled = submitting || isRunning;

                      return (
                        <TableRow
                          key={id}
                          data-state={isSelected ? "selected" : undefined}
                          className={
                            isDisabled
                              ? "cursor-not-allowed opacity-60"
                              : "cursor-pointer"
                          }
                          onClick={() => {
                            if (isDisabled) return;
                            setSourceId((current) =>
                              current === id ? "" : id,
                            );
                          }}
                        >
                          <TableCell className="w-12">
                            <Checkbox
                              checked={isSelected}
                              disabled={isDisabled}
                              onCheckedChange={(checked) => {
                                if (isDisabled) return;
                                setSourceId(checked === true ? id : "");
                              }}
                              aria-label={t("sources.scanWizard.selectSource", {
                                name: source.name ?? "source",
                              })}
                            />
                          </TableCell>
                          <TableCell className="font-medium">
                            {source.name ?? t("sources.unnamedSource")}
                          </TableCell>
                          <TableCell>{source.type ?? "—"}</TableCell>
                          <TableCell>
                            <Badge
                              className={`rounded-[4px] border ${getRunnerStatusBadgeTone(normalizedRunnerStatus)}`}
                            >
                              {isRunnerStatusRunning(
                                normalizedRunnerStatus,
                              ) && (
                                <Spinner
                                  size="sm"
                                  className="gap-0 [&_svg]:size-3"
                                  data-icon="inline-start"
                                />
                              )}
                              {t(getRunnerStatusBadgeLabel(normalizedRunnerStatus))}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
            {!loading && sources.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <p>{t("sources.scanWizard.noSources")}</p>
                <p className="text-sm mt-2">
                  {t("sources.scanWizard.noSourcesHint")}
                </p>
              </div>
            )}
          </div>
        </div>

        {error ? (
          <div className="px-4 pb-3">
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          </div>
        ) : null}

        <Separator />

        {/* Navigation Buttons */}
        <div className="flex items-center justify-end gap-2 p-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!canRun}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("sources.scanWizard.starting")}
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                {t("sources.scanWizard.runScan")}
              </>
            )}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
