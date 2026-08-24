"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, FileText, Loader2, UploadCloud, X } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Progress } from "@workspace/ui/components/progress";
import { cn } from "@workspace/ui/lib/utils";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/use-translation";
import {
  deleteSourceFile,
  uploadSourceFileWithProgress,
} from "@/lib/source-files-api";

export const MAX_UPLOADED_FILE_BYTES = 50 * 1024 * 1024;

export type UploadedFileMetadata = {
  id: string;
  sourceId: string;
  fileName: string;
  declaredMimeType: string;
  fileExtension: string;
  fileSizeBytes: number;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
};

export function pendingFileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

/** One upload still in flight, or one that failed and is showing why. */
type ActiveUpload = {
  key: string;
  name: string;
  size: number;
  progress: number;
  error?: string;
};

type UploadedFilesProps = {
  existingFiles: UploadedFileMetadata[];
  disabled?: boolean;
  /**
   * The source to upload into. When present the uploader is LIVE: a dropped
   * file starts uploading immediately, with progress, and a removed file is
   * deleted immediately. Absent — a source that does not exist yet — it queues
   * the files instead and the page uploads them after the create call.
   */
  sourceId?: string;
  /** Live mode: the stored list after an upload or a delete. */
  onFilesChange?: (files: UploadedFileMetadata[]) => void;
  /** Queued mode. */
  pendingFiles?: File[];
  pendingRemovalIds?: Set<string>;
  onPendingFilesChange?: (files: File[]) => void;
  onPendingRemovalIdsChange?: (ids: Set<string>) => void;
  /** SANDBOX: its files *are* the source, so the last one may not be removed. */
  requireAtLeastOne?: boolean;
};

/**
 * The files attached to a source.
 *
 * Two modes, because a source is not always saved yet. With a `sourceId` the
 * bytes go to the server as soon as they are dropped — which is the only
 * honest thing to show, and what makes "pending" disappear as a concept. Before
 * a source exists there is nothing to upload *to*, so the files are held and
 * the page sends them once the create call returns an id.
 */
export function UploadedFiles({
  existingFiles,
  disabled = false,
  sourceId,
  onFilesChange,
  pendingFiles = [],
  pendingRemovalIds = new Set<string>(),
  onPendingFilesChange,
  onPendingRemovalIdsChange,
  requireAtLeastOne = false,
}: UploadedFilesProps) {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<ActiveUpload[]>([]);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const dragDepth = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const live = Boolean(sourceId);

  // Uploads outlive a re-render but not the component; aborting on unmount
  // stops a half-sent 50 MB file writing into a source nobody is looking at.
  const abortsRef = useRef(new Map<string, () => void>());
  useEffect(() => {
    const aborts = abortsRef.current;
    return () => {
      for (const abort of aborts.values()) abort();
      aborts.clear();
    };
  }, []);

  const patchUpload = useCallback(
    (key: string, patch: Partial<ActiveUpload>) => {
      setUploads((current) =>
        current.map((entry) =>
          entry.key === key ? { ...entry, ...patch } : entry,
        ),
      );
    },
    [],
  );

  const startUpload = useCallback(
    (file: File) => {
      if (!sourceId) return;
      const key = `${pendingFileKey(file)}:${Date.now()}`;
      setUploads((current) => [
        ...current,
        { key, name: file.name, size: file.size, progress: 0 },
      ]);

      const { promise, abort } = uploadSourceFileWithProgress(
        sourceId,
        file,
        (fraction) => patchUpload(key, { progress: fraction }),
      );
      abortsRef.current.set(key, abort);

      void promise
        .then((stored) => {
          abortsRef.current.delete(key);
          setUploads((current) => current.filter((entry) => entry.key !== key));
          onFilesChange?.([stored, ...existingFiles]);
        })
        .catch((error: unknown) => {
          abortsRef.current.delete(key);
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          patchUpload(key, {
            error:
              error instanceof Error
                ? error.message
                : t("sources.uploadedFiles.uploadFailed"),
          });
        });
    },
    [existingFiles, onFilesChange, patchUpload, sourceId, t],
  );

  const append = useCallback(
    (incoming: File[]) => {
      const oversized = incoming.filter(
        (file) => file.size > MAX_UPLOADED_FILE_BYTES,
      );
      if (oversized.length > 0) {
        toast.error(
          t("sources.uploadedFiles.tooLarge", { count: oversized.length }),
        );
      }
      const accepted = incoming.filter(
        (file) => file.size <= MAX_UPLOADED_FILE_BYTES,
      );

      if (live) {
        accepted.forEach(startUpload);
        return;
      }

      const next = new Map(
        pendingFiles.map((file) => [pendingFileKey(file), file]),
      );
      for (const file of accepted) next.set(pendingFileKey(file), file);
      onPendingFilesChange?.([...next.values()]);
    },
    [live, onPendingFilesChange, pendingFiles, startUpload, t],
  );

  const removeStored = useCallback(
    (file: UploadedFileMetadata) => {
      if (!live) {
        onPendingRemovalIdsChange?.(new Set([...pendingRemovalIds, file.id]));
        return;
      }
      setDeletingIds((current) => new Set(current).add(file.id));
      void deleteSourceFile(sourceId!, file.id)
        .then(() => {
          onFilesChange?.(
            existingFiles.filter((entry) => entry.id !== file.id),
          );
        })
        .catch((error: unknown) => {
          toast.error(
            error instanceof Error
              ? error.message
              : t("sources.uploadedFiles.deleteFailed"),
          );
        })
        .finally(() => {
          setDeletingIds((current) => {
            const next = new Set(current);
            next.delete(file.id);
            return next;
          });
        });
    },
    [
      existingFiles,
      live,
      onFilesChange,
      onPendingRemovalIdsChange,
      pendingRemovalIds,
      sourceId,
      t,
    ],
  );

  const visibleExisting = existingFiles.filter(
    (file) => !pendingRemovalIds.has(file.id),
  );
  const resultingCount =
    visibleExisting.length + (live ? uploads.length : pendingFiles.length);

  return (
    <div className="space-y-4">
      {resultingCount > 0 && (
        <div className="space-y-2" data-testid="uploaded-files-list">
          {visibleExisting.map((file) => (
            <FileRow
              key={file.id}
              name={file.fileName}
              size={file.fileSizeBytes}
              busy={deletingIds.has(file.id)}
              onRemove={() => {
                if (requireAtLeastOne && resultingCount <= 1) {
                  toast.error(t("sources.uploadedFiles.keepOne"));
                  return;
                }
                removeStored(file);
              }}
              disabled={disabled}
            />
          ))}

          {live
            ? uploads.map((upload) => (
                <FileRow
                  key={upload.key}
                  name={upload.name}
                  size={upload.size}
                  progress={upload.error ? undefined : upload.progress}
                  error={upload.error}
                  onRemove={() => {
                    abortsRef.current.get(upload.key)?.();
                    abortsRef.current.delete(upload.key);
                    setUploads((current) =>
                      current.filter((entry) => entry.key !== upload.key),
                    );
                  }}
                  disabled={false}
                />
              ))
            : pendingFiles.map((file) => (
                <FileRow
                  key={pendingFileKey(file)}
                  name={file.name}
                  size={file.size}
                  queued
                  onRemove={() =>
                    onPendingFilesChange?.(
                      pendingFiles.filter(
                        (candidate) =>
                          pendingFileKey(candidate) !== pendingFileKey(file),
                      ),
                    )
                  }
                  disabled={disabled}
                />
              ))}
        </div>
      )}

      <div
        data-testid="uploaded-files-dropzone"
        className={cn(
          "rounded-[6px] border-2 border-dashed p-6 text-center transition-colors",
          dragging ? "border-foreground bg-accent" : "border-border",
          disabled && "pointer-events-none opacity-50",
        )}
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          append(Array.from(event.dataTransfer.files));
        }}
      >
        <UploadCloud className="mx-auto mb-3 h-8 w-8" />
        <p className="text-sm font-semibold">
          {t("sources.uploadedFiles.dropPrompt")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("sources.uploadedFiles.maximumSize")}
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            append(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          className="mt-4"
          onClick={() => inputRef.current?.click()}
        >
          {t("sources.uploadedFiles.chooseFiles")}
        </Button>
      </div>

      {resultingCount === 0 && (
        <p
          className="py-1 text-sm text-muted-foreground"
          data-testid="uploaded-files-list"
        >
          {requireAtLeastOne
            ? t("sources.uploadedFiles.required")
            : t("sources.uploadedFiles.empty")}
        </p>
      )}
    </div>
  );
}

function FileRow({
  name,
  size,
  queued,
  busy,
  progress,
  error,
  onRemove,
  disabled,
}: {
  name: string;
  size: number;
  /** Held until the source exists. */
  queued?: boolean;
  /** A delete is in flight. */
  busy?: boolean;
  /** 0–1 while uploading; undefined once stored. */
  progress?: number;
  error?: string;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const uploading = progress !== undefined && !error;

  return (
    <div
      className={cn(
        "rounded-[4px] border-2 px-3 py-2",
        error ? "border-destructive/60" : "border-border",
      )}
      data-testid={`uploaded-file-${name}`}
    >
      <div className="flex items-center gap-3">
        {error ? (
          <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
        ) : busy || uploading ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        ) : (
          <FileText className="h-4 w-4 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="text-xs text-muted-foreground">
            {formatFileSize(size)}
            {queued ? ` · ${t("sources.uploadedFiles.pending")}` : ""}
            {uploading
              ? ` · ${t("sources.uploadedFiles.uploading", {
                  percent: Math.round((progress ?? 0) * 100),
                })}`
              : ""}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled || busy}
          onClick={onRemove}
          aria-label={t("sources.uploadedFiles.remove", { name })}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {uploading && (
        <Progress
          value={Math.round((progress ?? 0) * 100)}
          className="mt-2 h-1"
        />
      )}
      {error && (
        <p className="mt-1 text-xs font-medium text-destructive">{error}</p>
      )}
    </div>
  );
}
