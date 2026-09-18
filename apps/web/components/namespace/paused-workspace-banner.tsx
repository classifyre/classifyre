"use client";

import Link from "next/link";
import { OctagonPause } from "lucide-react";
import { useNamespace } from "@/components/namespace-provider";
import { useTranslation } from "@/hooks/use-translation";

/**
 * Full-width warning shown on every dashboard page while the workspace is
 * paused: scans, schedules, harness cycles and duplicate checks are stopped
 * and mutations are rejected with 409. Links to the workspace settings where
 * the pause can be lifted. Renders nothing while running (or while the
 * namespace metadata is still resolving).
 */
export function PausedWorkspaceBanner() {
  const { namespace } = useNamespace();
  const { t } = useTranslation();

  if (!namespace || !namespace.paused) return null;

  return (
    <div
      role="alert"
      className="flex w-full flex-col gap-1 border-b border-amber-600/40 bg-amber-50 px-4 py-2.5 text-amber-900 sm:flex-row sm:items-center sm:gap-3 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <p className="flex min-w-0 items-center gap-2 text-sm">
        <OctagonPause className="size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0">
          <strong className="font-semibold">
            {t("workspaces.pausedBannerTitle")}
          </strong>
          <span className="text-amber-800 dark:text-amber-300">
            {" — "}
            {t("workspaces.pausedBannerDescription")}
          </span>
          {namespace.pausedReason ? (
            <span className="block truncate text-xs opacity-90 sm:ml-6">
              {t("workspaces.pausedBannerReason", {
                reason: namespace.pausedReason,
              })}
            </span>
          ) : null}
        </span>
      </p>
      <Link
        href={`/namespaces/${namespace.id}/settings`}
        className="shrink-0 text-xs font-semibold uppercase tracking-[0.08em] underline underline-offset-2 hover:no-underline sm:ml-auto"
      >
        {t("workspaces.pausedBannerAction")}
      </Link>
    </div>
  );
}
