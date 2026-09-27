"use client";

import * as React from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { api, type CaseCleanupPreviewDto } from "@workspace/api-client";
import { Label } from "@workspace/ui/components/label";
import { Switch } from "@workspace/ui/components/switch";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { CLEANUP_KEYS, type CleanupValues } from "./cleanup-rules";

/**
 * A case's three clean-up switches. On the edit page (`caseId` and `saved`
 * given) a switch turned on also says what saving will take out right away,
 * so nothing leaves the case without the investigator having seen it coming.
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
    const on = new Set(turnedOnKey.split(","));
    api.cases
      .caseCleanupControllerPreviewCleanup({
        id: caseId,
        caseCleanupRulesDto: {
          removeGoneFindings: on.has("removeGoneFindings"),
          removeResolvedFindings: on.has("removeResolvedFindings"),
          removeGoneAssets: on.has("removeGoneAssets"),
        },
      })
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

  const total = preview
    ? preview.goneFindings + preview.resolvedFindings + preview.goneAssets
    : 0;

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">{t("caseCleanup.description")}</p>
      <div className="space-y-2">
        {CLEANUP_KEYS.map((key) => (
          <div
            key={key}
            className={cn(
              "flex items-start gap-3 rounded-[4px] border-2 border-border p-3 transition-colors",
              values[key] && "border-accent-ink/40 bg-accent/5",
            )}
          >
            <Switch
              id={`${idPrefix}-${key}`}
              checked={values[key]}
              onCheckedChange={(checked) => onChange({ ...values, [key]: checked })}
              className="mt-0.5"
              data-testid={`cleanup-${key}`}
            />
            <div className="min-w-0 space-y-0.5">
              <Label htmlFor={`${idPrefix}-${key}`} className="cursor-pointer text-sm font-medium">
                {t(`caseCleanup.rules.${key}.label`)}
              </Label>
              <p className="text-muted-foreground text-xs">{t(`caseCleanup.rules.${key}.hint`)}</p>
            </div>
          </div>
        ))}
      </div>

      {caseId && turnedOn.length > 0 && (
        <div
          role="status"
          data-testid="cleanup-preview"
          className={cn(
            "rounded-[4px] border-2 p-3 text-sm",
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
                {t("caseCleanup.previewNow")}
              </p>
              <ul className="ml-6 list-disc space-y-0.5 text-xs">
                {preview.goneFindings > 0 && (
                  <li>{t("caseCleanup.previewGone", { count: preview.goneFindings })}</li>
                )}
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
      )}

      <p className="text-muted-foreground text-xs">{t("caseCleanup.timelineNote")}</p>
    </div>
  );
}
