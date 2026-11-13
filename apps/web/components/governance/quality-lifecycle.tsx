"use client";

import {
  ArrowRight,
  BellRing,
  CheckCircle2,
  ChevronDown,
  History,
  PencilLine,
  TimerReset,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";

const STEPS: { key: string; icon: LucideIcon }[] = [
  { key: "define", icon: PencilLine },
  { key: "measure", icon: TimerReset },
  { key: "record", icon: History },
  { key: "fail", icon: BellRing },
  { key: "recover", icon: CheckCircle2 },
];

/**
 * How a quality check lives (GOV §5.4): defined and tested, measured after
 * scans or on its schedule, every result kept, a failure opening one finding
 * and telling the people who answer for the asset, a pass closing it again.
 */
export function QualityLifecycle({ defaultOpen }: { defaultOpen?: boolean }) {
  const { t } = useTranslation();
  return (
    <details
      className="group rounded-[4px] border border-border/60 bg-muted/20"
      open={defaultOpen}
      data-testid="quality-lifecycle"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-semibold">
        {t("governance.qualityLifecycle.title")}
        <ChevronDown
          className="h-4 w-4 transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <ol className="grid gap-2 px-3 pb-3 md:grid-cols-5">
        {STEPS.map(({ key, icon: Icon }, index) => (
          <li key={key} className="relative flex gap-2 rounded-[4px] border border-border/50 bg-background p-3 md:flex-col">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] border border-border bg-accent text-accent-foreground">
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold">
                {index + 1}.{" "}
                {t(`governance.qualityLifecycle.${key}.title` as TranslationKey)}
              </span>
              <span className="block text-[11px] leading-snug text-muted-foreground">
                {t(`governance.qualityLifecycle.${key}.body` as TranslationKey)}
              </span>
            </span>
            {index < STEPS.length - 1 && (
              <ArrowRight
                className="absolute -right-2.5 top-1/2 hidden h-4 w-4 -translate-y-1/2 rounded-full bg-background text-muted-foreground md:block"
                aria-hidden
              />
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}
