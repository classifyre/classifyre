"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  FileText,
  Loader2,
  UploadCloud,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components";
import {
  SourceScanConfig,
  type DetectorConfigInput,
} from "@/components/source-scan-config";
import {
  SandboxStepperHeader,
  sandboxStepper,
} from "@/components/sandbox-stepper";
import { useTranslation } from "@/hooks/use-translation";

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

const getApiBase = () => process.env.NEXT_PUBLIC_API_URL ?? "/api";

const normalizeDetectors = (detectors: DetectorConfigInput[]) =>
  detectors
    .filter((detector) => detector.type.toUpperCase() !== "CUSTOM")
    .filter((detector) => detector.type && detector.enabled)
    .map((detector) => ({
      type: detector.type,
      enabled: true,
      config: detector.config ?? {},
    }));

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function fileKey(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

export default function NewSandboxScanPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const stepper = sandboxStepper.useStepper();

  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [detectors, setDetectors] = useState<DetectorConfigInput[]>([]);
  const [selectedCustomDetectorIds, setSelectedCustomDetectorIds] = useState<
    string[]
  >([]);
  const [scanSummary, setScanSummary] = useState({
    visibleCount: 0,
    enabledCount: 0,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  const showUploadStep = stepper.flow.is("upload");
  const showDetectorStep = stepper.flow.is("detectors");
  const enabledDetectors = useMemo(
    () => normalizeDetectors(detectors),
    [detectors],
  );
  const totalSizeBytes = useMemo(
    () => files.reduce((total, file) => total + file.size, 0),
    [files],
  );

  const canNavigateToDetectors = files.length > 0;
  const canRun =
    files.length > 0 &&
    (enabledDetectors.length > 0 || selectedCustomDetectorIds.length > 0) &&
    !isSubmitting;

  const appendFiles = useCallback((incomingFiles: File[]) => {
    if (incomingFiles.length === 0) return;

    const accepted: File[] = [];
    const rejected: string[] = [];

    for (const file of incomingFiles) {
      if (file.size > MAX_FILE_SIZE_BYTES) {
        rejected.push(file.name);
      } else {
        accepted.push(file);
      }
    }

    if (rejected.length > 0) {
      toast.error(t("upload.oversized", { count: rejected.length }));
    }

    if (accepted.length === 0) return;

    setFiles((prev) => {
      const map = new Map(prev.map((file) => [fileKey(file), file]));
      for (const file of accepted) {
        map.set(fileKey(file), file);
      }
      return Array.from(map.values());
    });
  }, []);

  const onDragEnter = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounter.current += 1;
    if (event.dataTransfer.items && event.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }, []);

  const onDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(false);
      dragCounter.current = 0;
      appendFiles(Array.from(event.dataTransfer.files));
    },
    [appendFiles],
  );

  const onFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const selected = Array.from(event.target.files ?? []);
      appendFiles(selected);
      event.target.value = "";
    },
    [appendFiles],
  );

  const removeFile = useCallback((target: File) => {
    const targetKey = fileKey(target);
    setFiles((prev) => prev.filter((file) => fileKey(file) !== targetKey));
  }, []);

  const handleRun = useCallback(async () => {
    if (!canRun) return;

    setIsSubmitting(true);
    try {
      const detectorPayload: Array<{
        type: string;
        enabled: boolean;
        config: Record<string, unknown>;
      }> = [...enabledDetectors];

      if (selectedCustomDetectorIds.length > 0) {
        const base = getApiBase();
        const customDetectors = await Promise.all(
          selectedCustomDetectorIds.map(async (id) => {
            const response = await fetch(`${base}/custom-detectors/${id}`);
            if (!response.ok) return null;
            return response.json() as Promise<{
              config: Record<string, unknown>;
            }>;
          }),
        );

        for (const customDetector of customDetectors) {
          if (!customDetector) continue;
          detectorPayload.push({
            type: "CUSTOM",
            enabled: true,
            config: customDetector.config ?? {},
          });
        }
      }

      if (detectorPayload.length === 0) {
        toast.error(t("sandbox.selectDetector"));
        return;
      }

      const base = getApiBase();
      const startRequests = files.map(async (file) => {
        const form = new FormData();
        form.append("file", file);
        form.append("detectors", JSON.stringify(detectorPayload));

        const response = await fetch(`${base}/sandbox/runs`, {
          method: "POST",
          body: form,
        });

        return { fileName: file.name, ok: response.ok };
      });

      const firstSuccessfulStart = await Promise.any(
        startRequests.map((request) =>
          request.then((result) => {
            if (result.ok) return result;
            throw new Error(`Failed to queue ${result.fileName}`);
          }),
        ),
      ).catch(() => {
        throw new Error("Failed to queue sandbox runs");
      });

      toast.success(t("upload.queued", { fileName: firstSuccessfulStart.fileName }));
      router.push("/sandbox");

      void Promise.allSettled(startRequests).then((results) => {
        const summary = results.reduce(
          (acc, result) => {
            if (result.status === "fulfilled" && result.value.ok) {
              acc.started += 1;
            } else {
              acc.failed += 1;
            }
            return acc;
          },
          { started: 0, failed: 0 },
        );

        if (summary.failed > 0) {
          toast.error(t("upload.failedToQueue", { count: summary.failed }));
        }
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("upload.failedToStart"),
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [canRun, enabledDetectors, files, router, selectedCustomDetectorIds]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild className="-ml-2 w-fit">
              <Link href="/sandbox">
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back to results
              </Link>
            </Button>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {t("sandbox.newScan")}
          </h1>
          <p className="text-sm text-muted-foreground">
            Upload one or more files, configure detectors, and run.
          </p>
        </div>
      </div>

      <SandboxStepperHeader canNavigateToDetectors={canNavigateToDetectors} />

      <div className={showUploadStep ? "block" : "hidden"}>
        <Card>
          <CardHeader>
            <CardTitle>{t("sandbox.uploadFiles")}</CardTitle>
            <CardDescription>
              {t("sandbox.uploadFilesDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              role="button"
              tabIndex={0}
              aria-label={t("sandbox.dropFiles")}
              onDragEnter={onDragEnter}
              onDragLeave={onDragLeave}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              className="relative flex min-h-56 cursor-pointer flex-col items-center justify-center gap-3 rounded-[6px] border-2 border-dashed p-8 transition-colors"
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="sr-only"
                onChange={onFileChange}
              />

              <div className="flex h-10 w-10 items-center justify-center rounded-[6px] border border-dashed">
                <UploadCloud className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="text-center">
                <p className="text-sm">
                  {isDragging ? t("sandbox.dropFilesActive") : t("sandbox.dropFiles")}
                </p>
                <p className="text-xs text-muted-foreground">
                  or{" "}
                  <span className="underline underline-offset-2">
                    click to browse
                  </span>
                </p>
              </div>
            </div>

            <div className="rounded-[6px] border">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
                <div className="text-xs text-muted-foreground">
                  {files.length} file{files.length === 1 ? "" : "s"} selected
                  {files.length > 0
                    ? ` · ${formatBytes(totalSizeBytes)} total`
                    : ""}
                </div>
                {files.length > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setFiles([])}
                  >
                    Clear all
                  </Button>
                ) : null}
              </div>

              {files.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No files selected yet.
                </div>
              ) : (
                <ul className="max-h-64 divide-y overflow-auto">
                  {files.map((file) => (
                    <li
                      key={fileKey(file)}
                      className="flex items-center gap-3 px-3 py-2"
                    >
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {file.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatBytes(file.size)}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => removeFile(file)}
                        aria-label={`Remove ${file.name}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                onClick={() => stepper.navigation.next()}
                disabled={!canNavigateToDetectors}
                className="w-full sm:w-auto"
              >
                Continue to detectors
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className={showDetectorStep ? "block" : "hidden"}>
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>{t("sandbox.detectors")}</CardTitle>
                <CardDescription>
                  {t("sandbox.detectorsDesc")}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-[0.12em]">
                <Badge variant="secondary">
                  {scanSummary.visibleCount} visible
                </Badge>
                <Badge variant="outline">
                  {scanSummary.enabledCount} enabled
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <SourceScanConfig
              mode="create"
              onDetectorsChange={setDetectors}
              onSummaryChange={setScanSummary}
              selectedCustomDetectorIds={selectedCustomDetectorIds}
              onCustomDetectorsChange={setSelectedCustomDetectorIds}
            />

            <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <Button
                variant="outline"
                onClick={() => stepper.navigation.prev()}
                disabled={isSubmitting}
                className="w-full sm:w-auto"
              >
                Back
              </Button>

              <Button
                onClick={() => void handleRun()}
                disabled={!canRun}
                className="w-full sm:w-auto"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Starting scans...
                  </>
                ) : (
                  <>
                    <Zap className="mr-2 h-4 w-4" />
                    Run {files.length} file{files.length === 1 ? "" : "s"}
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
