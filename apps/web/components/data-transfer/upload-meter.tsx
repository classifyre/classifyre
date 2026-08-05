"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

import { useTranslation } from "@/hooks/use-translation";
import { formatBytes, type UploadProgress } from "@/lib/data-transfer-api";

/**
 * Determinate progress for the upload itself, before the server has a job to
 * poll.
 *
 * An import has two phases the operator experiences as one wait: pushing the
 * archive up, then the server loading it. Only the second had a progress bar,
 * so a 250 MB archive spent minutes on an indeterminate spinner — long enough
 * to look hung. This covers the first phase; TransferProgressPanel takes over
 * for the second.
 */
export function UploadMeter({ progress }: { progress: UploadProgress }) {
  const { t } = useTranslation();
  const percent = progress.percent ?? 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          {progress.finalising
            ? t("dataTransfer.uploadReading")
            : t("dataTransfer.uploading")}
        </p>
        <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {progress.finalising
            ? formatBytes(progress.total)
            : `${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}`}
        </p>
      </div>

      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full bg-primary transition-[width] duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {progress.finalising
          ? t("dataTransfer.uploadReadingHint")
          : t("dataTransfer.uploadingHint")}
      </p>
    </div>
  );
}
