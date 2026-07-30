"use client";

import * as React from "react";
import { Button } from "@workspace/ui/components/button";
import { FileArchive, Loader2, Upload, X } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";

import { useTranslation } from "@/hooks/use-translation";
import { formatBytes, type TransferJob } from "@/lib/data-transfer-api";
import { TransferProgressPanel } from "@/components/data-transfer/transfer-progress";

/**
 * Optional archive attachment on the create-workspace form.
 *
 * The file is only held in memory here: there is no namespace to upload it to
 * until the workspace exists, so the dialog creates the workspace first and then
 * hands the file over. That ordering is why this is a picker rather than the
 * full import panel — it has nowhere to send the bytes yet.
 */
export function NamespaceSeedPicker({
  file,
  onFileChange,
  job,
  disabled,
}: {
  file: File | null;
  onFileChange: (file: File | null) => void;
  /** Set once the workspace exists and its seed import is running. */
  job: TransferJob | null;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  if (job) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          {t("workspaces.seedImporting")}
        </p>
        <TransferProgressPanel job={job} />
      </div>
    );
  }

  if (file) {
    return (
      <div className="flex items-center gap-2.5 rounded-[4px] border-2 border-border bg-muted/20 px-3 py-2">
        <FileArchive className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs">{file.name}</p>
          <p className="font-mono text-[10px] text-muted-foreground">
            {formatBytes(file.size)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onFileChange(null)}
          disabled={disabled}
          aria-label={t("workspaces.seedRemove")}
          className="shrink-0 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          {disabled ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <X className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    );
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const dropped = event.dataTransfer.files?.[0];
        if (dropped) onFileChange(dropped);
      }}
      className={cn(
        "flex items-center justify-between gap-3 rounded-[4px] border-2 border-dashed px-3 py-3 transition-colors",
        dragging ? "border-primary bg-primary/5" : "border-border",
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <Upload className="h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          {t("workspaces.seedHint")}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className="h-7 shrink-0 border-2 text-[11px]"
      >
        {t("workspaces.seedChoose")}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".cfyre,.gz,application/gzip"
        className="hidden"
        onChange={(event) => {
          const picked = event.target.files?.[0];
          if (picked) onFileChange(picked);
          event.target.value = "";
        }}
      />
    </div>
  );
}
