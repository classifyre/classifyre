"use client";

import { useCallback, useRef, useState } from "react";
import { FileText, UploadCloud, X } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { cn } from "@workspace/ui/lib/utils";
import { toast } from "sonner";

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

export function UploadedFiles({
  existingFiles,
  pendingFiles,
  pendingRemovalIds,
  onPendingFilesChange,
  onPendingRemovalIdsChange,
  disabled = false,
}: {
  existingFiles: UploadedFileMetadata[];
  pendingFiles: File[];
  pendingRemovalIds: Set<string>;
  onPendingFilesChange: (files: File[]) => void;
  onPendingRemovalIdsChange: (ids: Set<string>) => void;
  disabled?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const append = useCallback(
    (incoming: File[]) => {
      const oversized = incoming.filter(
        (file) => file.size > MAX_UPLOADED_FILE_BYTES,
      );
      if (oversized.length > 0) {
        toast.error(`${oversized.length} file(s) exceed the 50 MiB limit.`);
      }
      const next = new Map(
        pendingFiles.map((file) => [pendingFileKey(file), file]),
      );
      for (const file of incoming) {
        if (file.size <= MAX_UPLOADED_FILE_BYTES)
          next.set(pendingFileKey(file), file);
      }
      onPendingFilesChange([...next.values()]);
    },
    [onPendingFilesChange, pendingFiles],
  );

  const visibleExisting = existingFiles.filter(
    (file) => !pendingRemovalIds.has(file.id),
  );
  const resultingCount = visibleExisting.length + pendingFiles.length;

  return (
    <Card className="rounded-[6px] border-2 border-border shadow-[4px_4px_0_var(--color-border)]">
      <CardHeader>
        <CardTitle className="uppercase tracking-[0.06em]">
          Uploaded files
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          data-testid="uploaded-files-dropzone"
          className={cn(
            "rounded-[6px] border-2 border-dashed p-8 text-center transition-colors",
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
            Drop files here or choose files
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Maximum 50 MiB per file
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
            Choose files
          </Button>
        </div>

        <div className="space-y-2" data-testid="uploaded-files-list">
          {visibleExisting.map((file) => (
            <FileRow
              key={file.id}
              name={file.fileName}
              size={file.fileSizeBytes}
              onRemove={() => {
                if (resultingCount <= 1) {
                  toast.error("A Sandbox source must keep at least one file.");
                  return;
                }
                onPendingRemovalIdsChange(
                  new Set([...pendingRemovalIds, file.id]),
                );
              }}
              disabled={disabled}
            />
          ))}
          {pendingFiles.map((file) => (
            <FileRow
              key={pendingFileKey(file)}
              name={file.name}
              size={file.size}
              pending
              onRemove={() =>
                onPendingFilesChange(
                  pendingFiles.filter(
                    (candidate) =>
                      pendingFileKey(candidate) !== pendingFileKey(file),
                  ),
                )
              }
              disabled={disabled}
            />
          ))}
          {resultingCount === 0 && (
            <p className="py-2 text-sm text-muted-foreground">
              At least one file is required.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function FileRow({
  name,
  size,
  pending,
  onRemove,
  disabled,
}: {
  name: string;
  size: number;
  pending?: boolean;
  onRemove: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[4px] border-2 border-border px-3 py-2">
      <FileText className="h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="text-xs text-muted-foreground">
          {formatFileSize(size)}
          {pending ? " · pending upload" : ""}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled}
        onClick={onRemove}
        aria-label={`Remove ${name}`}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
