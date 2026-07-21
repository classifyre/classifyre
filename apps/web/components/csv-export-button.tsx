"use client";

import { useState } from "react";
import { Download, ExternalLink } from "lucide-react";
import { Button } from "@workspace/ui/components";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { getActiveNamespaceSlug } from "@workspace/api-client";

// Mirror of api-client getBaseUrl() for the browser: relative /api proxied by
// Next, with the active namespace slug appended (these export URLs are
// namespace-scoped, like every other API call).
function getApiBaseUrl(): string {
  const base = process.env.NEXT_PUBLIC_API_URL || "/api";
  const slug = getActiveNamespaceSlug();
  return slug ? `${base.replace(/\/+$/, "")}/${slug}` : base;
}

/**
 * Serializes a flat filters object into URL query params, matching how the
 * export DTOs coerce values (repeated keys for arrays, "true"/"false" for
 * booleans). Empty arrays, empty strings, null and undefined are skipped.
 */
export function filtersToSearchParams(
  filters: Record<string, unknown>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null && item !== "") {
          params.append(key, String(item));
        }
      }
    } else if (typeof value === "boolean") {
      params.set(key, value ? "true" : "false");
    } else if (value !== "") {
      params.set(key, String(value));
    }
  }
  return params;
}

export interface CsvExportButtonProps {
  /** API path of the streaming export endpoint, e.g. "search/findings/export". */
  exportPath: string;
  /** Lazily builds the filter query string from the table's current filters. */
  buildQuery: () => URLSearchParams;
  /** Number of rows that match the current filters (shown in the dialog). */
  total: number;
  /** Button label. */
  label?: string;
  /** Disables the trigger (e.g. while the table is still loading). */
  disabled?: boolean;
  /** Dialog title. */
  title?: string;
  /** Noun used in the count line, e.g. "findings", "assets", "rows". */
  entityLabel?: string;
}

/**
 * Reusable "Download CSV" control. Opens a confirmation dialog showing how many
 * rows will be exported, then triggers a native browser download by pointing an
 * anchor at the streaming export endpoint — nothing is buffered in JS memory.
 */
export function CsvExportButton({
  exportPath,
  buildQuery,
  total,
  label,
  disabled = false,
  title,
  entityLabel = "rows",
}: CsvExportButtonProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const handleDownload = () => {
    const qs = buildQuery().toString();
    const base = getApiBaseUrl().replace(/\/$/, "");
    const url = `${base}/${exportPath}${qs ? `?${qs}` : ""}`;

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="gap-2"
      >
        <Download className="h-4 w-4" />
        {label ?? t("csvExport.label" as TranslationKey)}
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title ?? t("csvExport.title" as TranslationKey)}</DialogTitle>
          <DialogDescription>
            {t("csvExport.description" as TranslationKey, { count: total.toLocaleString(), entityLabel })}{" "}
            <a
              href="/docs/data-export/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline underline-offset-2"
            >
              {t("csvExport.descriptionLink" as TranslationKey)}
              <ExternalLink className="h-3 w-3" />
            </a>
            {t("csvExport.descriptionSuffix" as TranslationKey)}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" size="sm">
              {t("csvExport.cancel" as TranslationKey)}
            </Button>
          </DialogClose>
          <Button size="sm" className="gap-2" onClick={handleDownload}>
            <Download className="h-4 w-4" />
            {t("csvExport.download" as TranslationKey)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
