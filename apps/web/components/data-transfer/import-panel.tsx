"use client";

import * as React from "react";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components";
import { FileUp, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@workspace/ui/lib/utils";

import { useTranslation } from "@/hooks/use-translation";
import { useTransferJob } from "@/hooks/use-transfer-job";
import {
  cancelTransferJob,
  deleteTransferJob,
  formatBytes,
  isRunning,
  listTransferScopes,
  startImport,
  uploadArchive,
  type ArchivePreview,
  type ConflictMode,
  type TransferJob,
  type TransferScopeId,
  type UploadProgress,
} from "@/lib/data-transfer-api";
import { UploadMeter } from "./upload-meter";
import { ScopePicker, type ScopeRow } from "./scope-picker";
import { NewIdentitiesNotice, SecretsNotice } from "./secrets-notice";
import { TransferProgressPanel } from "./transfer-progress";

export function ImportPanel({
  activeJob,
  onJobStarted,
  apiBase,
}: {
  activeJob: TransferJob | null;
  onJobStarted: () => void;
  /** Target a namespace other than the one being rendered (creation flow). */
  apiBase?: string;
}) {
  const { t } = useTranslation();
  const [preview, setPreview] = React.useState<ArchivePreview | null>(null);
  const [scopeRows, setScopeRows] = React.useState<ScopeRow[]>([]);
  const [selected, setSelected] = React.useState<Set<TransferScopeId>>(new Set());
  const [conflictMode, setConflictMode] = React.useState<ConflictMode>("SKIP");
  const [upload, setUpload] = React.useState<UploadProgress | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [starting, setStarting] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [jobId, setJobId] = React.useState<string | null>(activeJob?.id ?? null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const { job, refresh } = useTransferJob(jobId, apiBase);
  const current = job ?? activeJob;

  React.useEffect(() => {
    if (activeJob && activeJob.id !== jobId) setJobId(activeJob.id);
  }, [activeJob, jobId]);

  const handleFile = async (file: File) => {
    setUpload({
      loaded: 0,
      total: file.size,
      percent: 0,
      finalising: false,
    });
    try {
      const uploaded = await uploadArchive(file, apiBase, setUpload);

      // The archive's own scope list is the source of truth for what can be
      // taken from it; the catalogue only supplies the labels and descriptions.
      const catalogue = await listTransferScopes(apiBase).catch(() => []);
      const rows: ScopeRow[] = catalogue.map((scope) => ({
        ...scope,
        rows: uploaded.rowsByScope[scope.id] ?? null,
        available: uploaded.scopes.includes(scope.id),
      }));

      setPreview(uploaded);
      setScopeRows(rows);
      setSelected(new Set(uploaded.scopes));
      setJobId(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("dataTransfer.uploadFailed"),
      );
    } finally {
      setUpload(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  /**
   * Drop a staged upload rather than leaving its rows to expire. The upload
   * created a job holding the archive's bytes, so discarding the preview has to
   * discard that too.
   */
  const handleDiscard = async () => {
    const staged = preview;
    setPreview(null);
    if (!staged) return;
    await deleteTransferJob(staged.uploadId, apiBase).catch(() => undefined);
    onJobStarted();
  };

  const handleStart = async () => {
    if (!preview) return;
    setStarting(true);
    try {
      const started = await startImport(
        {
          uploadId: preview.uploadId,
          scopes: [...selected],
          conflictMode,
        },
        apiBase,
      );
      setJobId(started.id);
      setPreview(null);
      onJobStarted();
      toast.success(t("dataTransfer.importStarted"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("dataTransfer.importFailed"),
      );
    } finally {
      setStarting(false);
    }
  };

  const handleCancel = async () => {
    if (!current) return;
    setCancelling(true);
    try {
      await cancelTransferJob(current.id, apiBase);
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not cancel");
    } finally {
      setCancelling(false);
    }
  };

  const running =
    current !== null && current.kind === "IMPORT" && isRunning(current.status);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <FileUp className="mt-0.5 h-4 w-4" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-mono uppercase tracking-[0.14em]">
            {t("dataTransfer.importHeading")}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t("dataTransfer.importDesc")}
          </p>
        </div>
      </div>

      {!preview && !running ? (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files?.[0];
            if (file) void handleFile(file);
          }}
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-[4px] border-2 border-dashed px-4 py-10 text-center transition-colors",
            dragging
              ? "border-primary bg-primary/5"
              : "border-border hover:border-muted-foreground/50",
          )}
        >
          {upload ? (
            <div className="w-full max-w-sm">
              <UploadMeter progress={upload} />
            </div>
          ) : (
            <>
              <Upload className="h-5 w-5 text-muted-foreground" />
              <p className="text-sm">{t("dataTransfer.dropArchive")}</p>
              <p className="font-mono text-[11px] text-muted-foreground">
                {t("dataTransfer.archiveHint")}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => inputRef.current?.click()}
                className="mt-1 h-8 border-2 text-xs"
              >
                {t("dataTransfer.chooseFile")}
              </Button>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".cfyre,.gz,application/gzip"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
        </div>
      ) : null}

      {preview ? (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3 rounded-[4px] border-2 border-border bg-muted/20 px-3 py-2.5">
            <dl className="grid min-w-0 flex-1 gap-x-6 gap-y-1 font-mono text-[11px] tabular-nums sm:grid-cols-2">
              <Field label={t("dataTransfer.archiveFile")} value={preview.fileName} />
              <Field
                label={t("dataTransfer.archiveSize")}
                value={formatBytes(preview.fileSize)}
              />
              <Field
                label={t("dataTransfer.archiveFrom")}
                value={preview.sourceNamespace}
              />
              <Field
                label={t("dataTransfer.archiveCreated")}
                value={new Date(preview.createdAt).toLocaleString()}
              />
            </dl>
            <button
              type="button"
              onClick={() => void handleDiscard()}
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              aria-label={t("dataTransfer.discardArchive")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <SecretsNotice variant="import" />
          <NewIdentitiesNotice />

          <ScopePicker
            scopes={scopeRows}
            selected={selected}
            onChange={setSelected}
            disabled={starting}
            emptyLabel={t("dataTransfer.archiveEmpty")}
          />

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                {t("dataTransfer.conflictMode")}
              </p>
              <Select
                value={conflictMode}
                onValueChange={(value) => setConflictMode(value as ConflictMode)}
              >
                <SelectTrigger className="h-9 w-64 rounded-[4px] border-2 border-border text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SKIP">
                    {t("dataTransfer.conflictSkip")}
                  </SelectItem>
                  <SelectItem value="OVERWRITE">
                    {t("dataTransfer.conflictOverwrite")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={handleStart}
              disabled={starting || selected.size === 0}
              className="h-9 gap-1.5 text-xs"
            >
              {starting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileUp className="h-3.5 w-3.5" />
              )}
              {t("dataTransfer.startImport")}
            </Button>
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {conflictMode === "OVERWRITE"
              ? t("dataTransfer.conflictOverwriteHint")
              : t("dataTransfer.conflictSkipHint")}
          </p>
        </div>
      ) : null}

      {current && current.kind === "IMPORT" && !preview ? (
        <TransferProgressPanel
          job={current}
          onCancel={handleCancel}
          cancelling={cancelling}
        />
      ) : null}

      {current?.kind === "IMPORT" && !running && !preview ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setJobId(null);
            onJobStarted();
          }}
          className="h-8 border-2 text-xs"
        >
          {t("dataTransfer.importAnother")}
        </Button>
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}
