"use client";

import * as React from "react";
import Link from "next/link";
import { PowerOff } from "lucide-react";
import type { WorkspaceFeatureKey } from "@workspace/api-client";
import type { TranslationKey } from "@/i18n";
import { useTranslation } from "@/hooks/use-translation";
import { useWorkspaceFeatures } from "@/hooks/use-workspace-features";
import { useNsPath } from "@/lib/ns-path";

/**
 * Where the feature switches live. The anchor lands on the Features card of
 * the Cleanup tab, so "turn it back on" is one click from wherever the notice
 * is shown.
 */
export const FEATURE_SWITCHES_PATH = "/settings?tab=cleanup#features";

/**
 * "This part of the page is quiet because a feature is turned off", with the
 * way back.
 *
 * Renders nothing unless the feature is known to be off — never while the
 * switches are loading or unreadable, so the notice cannot flash on a page
 * where nothing is wrong. `context` picks the sentence explaining what this
 * particular page loses (`features.notice.<feature>.<context>`).
 */
export function FeatureOffNotice({
  feature,
  context,
  variant = "banner",
  className,
}: {
  feature: WorkspaceFeatureKey;
  context: string;
  /** `banner` above a page section; `inline` inside a card or panel. */
  variant?: "banner" | "inline";
  className?: string;
}) {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  const { isOff } = useWorkspaceFeatures();

  if (!isOff(feature)) return null;

  const title = t(`features.notice.${feature}.title` as TranslationKey);
  const body = t(`features.notice.${feature}.${context}` as TranslationKey);
  const action = (
    <Link
      href={nsPath(FEATURE_SWITCHES_PATH)}
      className="shrink-0 text-xs font-semibold uppercase tracking-[0.08em] underline underline-offset-2 hover:no-underline"
    >
      {t("features.notice.action")}
    </Link>
  );

  if (variant === "inline") {
    return (
      <div
        role="note"
        data-testid={`feature-off-${feature}`}
        className={`flex flex-wrap items-start gap-x-2 gap-y-1 rounded-[4px] border border-amber-600/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300 ${className ?? ""}`}
      >
        <PowerOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          <strong className="font-semibold">{title}.</strong> {body}
        </span>
        {action}
      </div>
    );
  }

  return (
    <div
      role="status"
      data-testid={`feature-off-${feature}`}
      className={`flex w-full flex-col gap-1 rounded-[4px] border border-amber-600/40 bg-amber-50 px-4 py-2.5 text-amber-900 sm:flex-row sm:items-center sm:gap-3 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200 ${className ?? ""}`}
    >
      <p className="flex min-w-0 items-start gap-2 text-sm">
        <PowerOff className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span className="min-w-0">
          <strong className="font-semibold">{title}</strong>
          <span className="text-amber-800 dark:text-amber-300">
            {" — "}
            {body}
          </span>
        </span>
      </p>
      <span className="sm:ml-auto">{action}</span>
    </div>
  );
}
