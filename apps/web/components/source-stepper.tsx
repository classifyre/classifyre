"use client";

import { defineStepper } from "@stepperize/react";
import { Button } from "@workspace/ui/components/button";
import { Badge } from "@workspace/ui/components/badge";
import { cn } from "@workspace/ui/lib/utils";
import { aiAccentBase, aiAccentHoverYellow } from "@/lib/ai-styles";
import { useTranslation } from "@/hooks/use-translation";

export const sourceStepper = defineStepper(
  { id: "config" },
  { id: "detectors" },
);

export function SourceStepperHeader({
  canNavigateToDetectors,
}: {
  canNavigateToDetectors: boolean;
}) {
  const { t } = useTranslation();
  const stepper = sourceStepper.useStepper();
  const currentIndex = stepper.state.current.index;

  const stepMeta: Record<string, { title: string; description: string }> = {
    config: {
      title: t("sources.stepper.sourceDetails"),
      description: t("sources.stepper.sourceDetailsDesc"),
    },
    detectors: {
      title: t("sources.stepper.detectors"),
      description: t("sources.stepper.detectorsDesc"),
    },
  };

  const stepButtons = sourceStepper.steps.map((step, index) => {
    const isActive = currentIndex === index;
    const isComplete = currentIndex > index;
    const status = isComplete ? "done" : isActive ? "active" : "locked";
    const canNavigate =
      step.id === "detectors" ? canNavigateToDetectors || isActive : true;
    const meta = stepMeta[step.id] ?? { title: step.id, description: "" };

    const statusLabel =
      status === "active"
        ? t("sources.stepper.active")
        : status === "done"
          ? t("sources.stepper.done")
          : t("sources.stepper.locked");

    return (
      <li key={step.id}>
        <Button
          type="button"
          variant="ghost"
          disabled={!canNavigate}
          onClick={() => stepper.navigation.goTo(step.id)}
          className={cn(
            "h-auto w-full items-start justify-between gap-4 rounded-[4px] border-2 border-black px-4 py-3 text-left shadow-[4px_4px_0_#000]",
            status === "active" && cn(aiAccentBase, aiAccentHoverYellow),
            status === "done" && "bg-black text-white",
            status === "locked" && "bg-muted/20",
            !canNavigate && "opacity-60",
          )}
        >
          <div className="space-y-1 min-w-0">
            <div className="text-[11px] font-mono uppercase tracking-[0.18em]">
              {t("sources.stepper.step", { index: index + 1 })}
            </div>
            <div className="text-sm font-semibold uppercase tracking-[0.04em]">
              {meta.title}
            </div>
            <div
              className={cn(
                "text-xs",
                status === "done" ? "text-white/70" : "text-muted-foreground",
              )}
            >
              {meta.description}
            </div>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "rounded-[4px] border text-[10px] uppercase tracking-[0.16em]",
              status === "active" && "bg-[#b7ff00] text-black border-black",
              status === "done" && "bg-white text-black border-white",
              status === "locked" && "bg-transparent",
            )}
          >
            {statusLabel}
          </Badge>
        </Button>
      </li>
    );
  });

  return (
    <div>
      <ol className="grid gap-3 md:grid-cols-2">{stepButtons}</ol>
    </div>
  );
}
