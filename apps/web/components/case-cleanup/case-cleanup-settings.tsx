"use client";

import * as React from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { api, type CaseCleanupPreviewDto } from "@workspace/api-client";
import { Label } from "@workspace/ui/components/label";
import { Switch } from "@workspace/ui/components/switch";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { CLEANUP_KEYS, type CleanupKey, type CleanupValues } from "./cleanup-rules";

/**
 * A case's three clean-up switches. With `caseId` and `saved` given, a switch
 * turned on also says what saving will take out right away, so nothing leaves
 * the case without the investigator having seen it coming.
 */
export function CaseCleanupSettings({
  values,
  onChange,
  caseId,
  saved,
  idPrefix = "cleanup",
}: {
  values: CleanupValues;
  onChange: (next: CleanupValues) => void;
  caseId?: string;
  /** The switches as stored: only the ones turned on since are previewed. */
  saved?: CleanupValues;
  idPrefix?: string;
}) {
  const { t } = useTranslation();
  const turnedOn = CLEANUP_KEYS.filter((key) => values[key] && !saved?.[key]);
  const { preview, checking } = useCleanupPreview(caseId, turnedOn);

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">{t("caseCleanup.description")}</p>
      <CleanupSwitches
        values={values}
        onToggle={(key, checked) => onChange({ ...values, [key]: checked })}
        idPrefix={idPrefix}
      />
      {caseId && turnedOn.length > 0 && <CleanupPreviewNote preview={preview} checking={checking} />}
      <p className="text-muted-foreground text-xs">{t("caseCleanup.timelineNote")}</p>
    </div>
  );
}

/** The three switches, each with what it does. */
export function CleanupSwitches({
  values,
  onToggle,
  idPrefix = "cleanup",
  disabled = false,
  busyKey = null,
  compact = false,
}: {
  values: CleanupValues;
  onToggle: (key: CleanupKey, checked: boolean) => void;
  idPrefix?: string;
  disabled?: boolean;
  /** The switch whose change is being saved. */
  busyKey?: CleanupKey | null;
  /** Tighter rows, for a side panel. */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className={compact ? "space-y-1.5" : "space-y-2"}>
      {CLEANUP_KEYS.map((key) => (
        <div
          key={key}
          className={cn(
            "flex items-start gap-3 rounded-[4px] border-2 border-border transition-colors",
            compact ? "p-2.5" : "p-3",
            values[key] && "border-accent-ink/40 bg-accent/5",
          )}
        >
          <Switch
            id={`${idPrefix}-${key}`}
            checked={values[key]}
            disabled={disabled || busyKey !== null}
            onCheckedChange={(checked) => onToggle(key, checked)}
            className="mt-0.5"
            data-testid={`cleanup-${key}`}
          />
          <div className="min-w-0 flex-1 space-y-0.5">
            <Label htmlFor={`${idPrefix}-${key}`} className="cursor-pointer text-sm font-medium">
              {t(`caseCleanup.rules.${key}.label`)}
            </Label>
            <p className="text-muted-foreground text-xs">{t(`caseCleanup.rules.${key}.hint`)}</p>
          </div>
          {busyKey === key && <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-muted-foreground" />}
        </div>
      ))}
    </div>
  );
}

/** What the given switches would take out of the case right now. Writes nothing. */
export function fetchCleanupPreview(caseId: string, keys: readonly CleanupKey[]): Promise<CaseCleanupPreviewDto> {
  const on = new Set(keys);
  return api.cases.caseCleanupControllerPreviewCleanup({
    id: caseId,
    caseCleanupRulesDto: {
      removeGoneFindings: on.has("removeGoneFindings"),
      removeResolvedFindings: on.has("removeResolvedFindings"),
      removeGoneAssets: on.has("removeGoneAssets"),
    },
  });
}

export function cleanupPreviewTotal(preview: CaseCleanupPreviewDto | null): number {
  return preview ? preview.goneFindings + preview.resolvedFindings + preview.goneAssets : 0;
}

/** The preview for the switches turned on (none: nothing to preview). */
export function useCleanupPreview(
  caseId: string | undefined,
  turnedOn: readonly CleanupKey[],
): { preview: CaseCleanupPreviewDto | null; checking: boolean } {
  const turnedOnKey = turnedOn.join(",");
  const [preview, setPreview] = React.useState<CaseCleanupPreviewDto | null>(null);
  const [checking, setChecking] = React.useState(false);

  React.useEffect(() => {
    if (!caseId || turnedOnKey === "") {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setChecking(true);
    fetchCleanupPreview(caseId, turnedOnKey.split(",") as CleanupKey[])
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId, turnedOnKey]);

  return { preview, checking };
}

/** What switching a rule on takes out right away, with a sample of it. */
export function CleanupPreviewNote({
  preview,
  checking,
  heading,
}: {
  preview: CaseCleanupPreviewDto | null;
  checking: boolean;
  /** What leads the list (default: "Saving takes these out…"). */
  heading?: string;
}) {
  const { t } = useTranslation();
  const total = cleanupPreviewTotal(preview);
  return (
    <div
      role="status"
      data-testid="cleanup-preview"
      className={cn(
        // min-w-0: long sample values truncate instead of widening a dialog.
        "min-w-0 overflow-hidden rounded-[4px] border-2 p-3 text-sm",
        total > 0
          ? "border-amber-600/35 bg-amber-50 text-amber-900 dark:border-amber-400/30 dark:bg-amber-950/40 dark:text-amber-200"
          : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {checking && !preview ? (
        <span className="inline-flex items-center gap-2">
          <Loader2 className="size-3.5 animate-spin" /> {t("caseCleanup.previewChecking")}
        </span>
      ) : preview && total > 0 ? (
        <div className="space-y-2">
          <p className="flex items-center gap-2 font-medium">
            <TriangleAlert className="size-4 shrink-0" aria-hidden />
            {heading ?? t("caseCleanup.previewNow")}
          </p>
          <ul className="ml-6 list-disc space-y-0.5 text-xs">
            {preview.goneFindings > 0 && <li>{t("caseCleanup.previewGone", { count: preview.goneFindings })}</li>}
            {preview.resolvedFindings > 0 && (
              <li>{t("caseCleanup.previewResolved", { count: preview.resolvedFindings })}</li>
            )}
            {preview.goneAssets > 0 && (
              <li>
                {t("caseCleanup.previewAssets", {
                  count: preview.goneAssets,
                  findings: preview.findingsWithAssets,
                })}
              </li>
            )}
          </ul>
          {preview.sample.length > 0 && (
            <ul className="ml-6 space-y-0.5 font-mono text-[11px] opacity-80">
              {preview.sample.map((item, index) => (
                <li key={index} className="truncate">
                  {item.reason === "ASSET_GONE" ? (
                    item.label
                  ) : (
                    <>
                      {item.label}
                      {item.value ? `: ${item.value}` : ""}
                      {item.assetLabel ? ` · ${item.assetLabel}` : ""}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p>{t("caseCleanup.previewNothing")}</p>
      )}
    </div>
  );
}
