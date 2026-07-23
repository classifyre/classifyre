"use client";

import * as React from "react";
import Image from "next/image";
import { ImagePlus, X } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";

const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const ACCEPTED = "image/png,image/jpeg,image/webp,image/gif,image/avif";

function readAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * Square-ish workspace thumbnail picker: an empty dashed drop target, or the
 * chosen image with a hover "remove" affordance. Emits a base64 data URI (≤2 MB)
 * or `null` when cleared; the parent decides when to persist it.
 */
export function ThumbnailPicker({
  value,
  onChange,
  disabled,
  className,
}: {
  value: string | null;
  onChange: (dataUri: string | null) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [error, setError] = React.useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError(t("workspaces.thumbnailTypeError"));
      return;
    }
    if (file.size > MAX_THUMBNAIL_BYTES) {
      setError(t("workspaces.thumbnailSizeError"));
      return;
    }
    try {
      onChange(await readAsDataUri(file));
    } catch {
      setError(t("workspaces.thumbnailReadError"));
    }
  };

  const clear = (event: React.MouseEvent) => {
    event.stopPropagation();
    setError(null);
    onChange(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const openPicker = () => {
    if (!disabled) inputRef.current?.click();
  };

  return (
    <div className={cn("space-y-2", className)}>
      <button
        type="button"
        onClick={openPicker}
        disabled={disabled}
        aria-label={t("workspaces.thumbnailLabel")}
        className={cn(
          "group relative flex aspect-[16/8.5] w-full items-center justify-center overflow-hidden rounded-sm border text-muted-foreground transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          value
            ? "border-border"
            : "border-dashed bg-secondary hover:border-primary/50 hover:text-foreground",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        {value ? (
          <>
            <Image
              src={value}
              alt=""
              fill
              unoptimized
              sizes="(min-width: 640px) 28rem, 100vw"
              className="object-cover object-top"
            />
            {!disabled && (
              <span className="absolute inset-0 flex items-center justify-center bg-foreground/0 opacity-0 transition group-hover:bg-foreground/30 group-hover:opacity-100">
                <span className="rounded-sm bg-background/90 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-foreground">
                  {t("workspaces.thumbnailReplace")}
                </span>
              </span>
            )}
          </>
        ) : (
          <span className="flex flex-col items-center gap-1.5 px-4 text-center">
            <ImagePlus className="size-6" strokeWidth={1.5} />
            <span className="text-xs font-medium">
              {t("workspaces.thumbnailCta")}
            </span>
            <span className="text-[11px] text-muted-foreground/70">
              {t("workspaces.thumbnailHint")}
            </span>
          </span>
        )}
      </button>

      {value && !disabled && (
        <button
          type="button"
          onClick={clear}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-destructive"
        >
          <X className="size-3.5" />
          {t("workspaces.thumbnailRemove")}
        </button>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        className="sr-only"
        disabled={disabled}
        onChange={(event) => void pick(event.target.files?.[0])}
      />
    </div>
  );
}
