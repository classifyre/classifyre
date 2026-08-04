"use client";

import * as React from "react";
import { ArrowUpRight, Boxes, Laptop } from "lucide-react";
import {
  desktopDownloadUrl,
  helmDeploymentUrl,
} from "@workspace/ui/lib/site-links";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";

/**
 * The demo deployment is read-only, so every wall a visitor hits is really an
 * invitation to run their own instance. Both walls — the header badge and the
 * blocked-action dialog — render the same two options from here so the pitch
 * (and the URLs behind it) exist once.
 */

type Option = {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
  ctaKey: TranslationKey;
};

const OPTIONS: Option[] = [
  {
    href: desktopDownloadUrl,
    icon: Laptop,
    titleKey: "demo.desktopTitle",
    descriptionKey: "demo.desktopDescription",
    ctaKey: "demo.desktopCta",
  },
  {
    href: helmDeploymentUrl,
    icon: Boxes,
    titleKey: "demo.helmTitle",
    descriptionKey: "demo.helmDescription",
    ctaKey: "demo.helmCta",
  },
];

/**
 * Two side-by-side cards on a roomy viewport, stacked on a phone. Rendered
 * inside dialogs that are themselves width-capped, so the breakpoint is the
 * `sm:` container query proxy rather than the viewport being "desktop".
 */
export function DemoUpgradeOptions({ className }: { className?: string }) {
  const { t } = useTranslation();

  return (
    <div className={cn("grid gap-2.5 sm:grid-cols-2", className)}>
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        return (
          <a
            key={option.href}
            href={option.href}
            target="_blank"
            rel="noreferrer"
            className="group/option flex flex-col gap-1.5 rounded-[4px] border border-border bg-card p-3 text-left transition-colors hover:border-amber-600/50 hover:bg-amber-50/60 focus-visible:border-amber-600/50 focus-visible:ring-[3px] focus-visible:ring-amber-600/20 focus-visible:outline-none dark:hover:border-amber-500/40 dark:hover:bg-amber-950/30 dark:focus-visible:border-amber-500/40"
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Icon className="size-4 shrink-0 text-amber-600 dark:text-amber-500" />
              {t(option.titleKey)}
            </span>
            <span className="text-muted-foreground text-xs leading-relaxed">
              {t(option.descriptionKey)}
            </span>
            <span className="mt-auto inline-flex items-center gap-1 pt-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
              {t(option.ctaKey)}
              <ArrowUpRight className="size-3 transition-transform group-hover/option:translate-x-0.5 group-hover/option:-translate-y-0.5" />
            </span>
          </a>
        );
      })}
    </div>
  );
}

/** Footnote under the options: both paths are free and keep data in place. */
export function DemoUpgradeFootnote({ className }: { className?: string }) {
  const { t } = useTranslation();

  return (
    <p className={cn("text-muted-foreground text-xs", className)}>
      {t("demo.upgradeFootnote")}
    </p>
  );
}
